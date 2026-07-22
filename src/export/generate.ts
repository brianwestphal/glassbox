import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

import { getAttachmentsForReview } from '../db/attachment-queries.js';
import { getAnnotationsForReview,getReview, getReviewFiles } from '../db/queries.js';
import { ImageRegionSchema } from '../db/schemas.js';
import { parseModeString } from '../git/diff.js';
import { extractMetadata } from '../git/image-metadata.js';
import { reviewNotesExportSection } from '../review-notes/format.js';
import { formatReviewMode } from '../utils/formatReviewMode.js';
import type { ImageDims } from './build-data.js';
import { buildReviewExportData } from './build-data.js';
import { buildReviewMarkdown } from './build-markdown.js';

export function deleteReviewExport(reviewId: string, repoRoot: string): void {
  const exportDir = join(repoRoot, '.glassbox');
  for (const ext of ['md', 'json'] as const) {
    const archivePath = join(exportDir, `review-${reviewId}.${ext}`);
    if (existsSync(archivePath)) unlinkSync(archivePath);
  }
}

/**
 * The anchor label for an annotation in the markdown export. Line annotations
 * read `**Line N**`; image-level annotations (doc 23, `line_number === 0`) read
 * `**Image region (x%, y%, w%×h%)**` when anchored to a rectangle, or
 * `**Image comment**` for a general comment. A region scoped to one side
 * (doc 23 §23.6) adds a `, A image only` / `, B image only` qualifier.
 *
 * `region_data` is decoded defensively: a corrupt value must not abort the whole
 * export, so a parse/shape failure falls through to `**Image comment**` (the
 * sibling decoders in `build-data.ts` and `artifactRegions.ts` guard the same way).
 */
function annotationAnchorLabel(a: { line_number: number; region_data: string | null }): string {
  if (a.line_number !== 0) return `**Line ${a.line_number}**`;
  if (a.region_data !== null) {
    let raw: unknown;
    try {
      raw = JSON.parse(a.region_data);
    } catch {
      return '**Image comment**';
    }
    const parsed = ImageRegionSchema.safeParse(raw);
    if (parsed.success) {
      const { x, y, w, h, side } = parsed.data;
      const pct = (n: number) => `${Math.round(n * 100)}%`;
      const scope = side === 'old' ? ', A image only' : side === 'new' ? ', B image only' : '';
      return `**Image region (${pct(x)}, ${pct(y)}, ${pct(w)}×${pct(h)}${scope})**`;
    }
  }
  return '**Image comment**';
}

export async function generateReviewExport(reviewId: string, repoRoot: string, isCurrent: boolean): Promise<string> {
  const review = await getReview(reviewId);
  if (!review) throw new Error('Review not found');

  const files = await getReviewFiles(reviewId);
  const annotations = await getAnnotationsForReview(reviewId);

  const exportDir = join(repoRoot, '.glassbox');
  mkdirSync(exportDir, { recursive: true });

  // A clean, short mode label — never the raw serialized mode string, which for
  // ground-truth (doc 26) is a large JSON payload (the GB-971 bug class).
  const modeLabel = formatReviewMode(review.mode, review.mode_args);
  const exportDate = new Date().toISOString();

  // Reviewer attachments, grouped by the annotation they hang off (doc 25), so
  // they can be listed inline under each comment with their on-disk paths.
  const attachments = await getAttachmentsForReview(reviewId);
  const attByAnnotation: Record<string, typeof attachments> = {};
  for (const at of attachments) {
    (attByAnnotation[at.annotation_id] ??= []).push(at);
  }

  const content = buildReviewMarkdown({
    review,
    files,
    annotations,
    attachmentsByAnnotation: attByAnnotation,
    modeLabel,
    date: exportDate,
    // AI-authored review notes from `.pr-notes/` (docs/20 §20.8, P5) — fold the
    // generating AI's own rationale/proof into the export for the next session.
    reviewNoteLines: reviewNotesExportSection(repoRoot, files.map(f => f.file_path)),
    anchorLabel: annotationAnchorLabel,
  });

  // Structured JSON companion (doc 6) for programmatic consumers (e.g. a
  // --on-complete hook that files tickets). Built from the same data so it never
  // drifts from the markdown's annotation set.
  const exportData = buildReviewExportData({
    review,
    files,
    annotations,
    attachments,
    mode: parseModeString(review.mode),
    modeLabel,
    date: exportDate,
    isCurrent,
    resolveDims: resolveImageDims,
  });
  const json = JSON.stringify(exportData, null, 2);

  // Always write the per-ID archive (markdown + json)
  const archivePath = join(exportDir, `review-${review.id}.md`);
  writeFileSync(archivePath, content, 'utf-8');
  writeFileSync(join(exportDir, `review-${review.id}.json`), json, 'utf-8');

  // Only write the latest-* files for the current review
  if (isCurrent) {
    const latestPath = join(exportDir, 'latest-review.md');
    writeFileSync(latestPath, content, 'utf-8');
    writeFileSync(join(exportDir, 'latest-review.json'), json, 'utf-8');
    return latestPath;
  }

  return archivePath;
}

/** Resolve an image's natural pixel size from its absolute path via a cheap
 *  header read (PNG/JPEG bytes, SVG header), for denormalizing region rectangles
 *  in the JSON export. Returns null when the file is unreadable or its size can't
 *  be determined; pixel coords are then omitted (the normalized rect still rides). */
function resolveImageDims(absPath: string): ImageDims {
  try {
    const meta = extractMetadata(readFileSync(absPath), absPath);
    if (meta.width !== null && meta.height !== null) {
      return { width: meta.width, height: meta.height };
    }
  } catch { /* unreadable / undecodable — no pixel coords */ }
  return null;
}
