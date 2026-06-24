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

  // Group annotations by file
  const byFile: Record<string, typeof annotations> = {};
  for (const a of annotations) {
    if (!(a.file_path in byFile)) byFile[a.file_path] = [];
    byFile[a.file_path].push(a);
  }

  const lines: string[] = [];

  // A clean, short mode label — never the raw serialized mode string, which for
  // ground-truth (doc 26) is a large JSON payload (the GB-971 bug class).
  const modeLabel = formatReviewMode(review.mode, review.mode_args);
  const exportDate = new Date().toISOString();

  lines.push('# Code Review');
  lines.push('');
  lines.push(`- **Repository**: ${review.repo_name}`);
  lines.push(`- **Review mode**: ${modeLabel}`);
  lines.push(`- **Review ID**: ${review.id}`);
  lines.push(`- **Date**: ${exportDate}`);
  lines.push(`- **Files reviewed**: ${files.filter(f => f.status === 'reviewed').length}/${files.length}`);
  lines.push(`- **Total annotations**: ${annotations.length}`);
  lines.push('');

  // Summary of categories
  const categoryCounts: Record<string, number> = {};
  for (const a of annotations) {
    categoryCounts[a.category] = (categoryCounts[a.category] || 0) + 1;
  }
  if (Object.keys(categoryCounts).length > 0) {
    lines.push('## Annotation Summary');
    lines.push('');
    for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`- **${cat}**: ${count}`);
    }
    lines.push('');
  }

  // Items tagged "remember" should be prominent for AI tools
  const rememberItems = annotations.filter(a => a.category === 'remember');
  if (rememberItems.length > 0) {
    lines.push('## Items to Remember');
    lines.push('');
    lines.push('> These annotations are flagged for long-term retention. AI tools should consider updating');
    lines.push('> project configuration (CLAUDE.md, .cursorrules, etc.) with these preferences/rules.');
    lines.push('');
    for (const item of rememberItems) {
      const anchor = item.line_number === 0 ? `${item.file_path} (image)` : `${item.file_path}:${item.line_number}`;
      lines.push(`- **${anchor}** - ${item.content}`);
    }
    lines.push('');
  }

  // Reviewer attachments, grouped by the annotation they hang off (doc 25), so
  // they can be listed inline under each comment with their on-disk paths.
  const attachments = await getAttachmentsForReview(reviewId);
  const attByAnnotation: Record<string, typeof attachments> = {};
  for (const at of attachments) {
    (attByAnnotation[at.annotation_id] ??= []).push(at);
  }

  // Per-file annotations
  lines.push('## File Annotations');
  lines.push('');

  for (const filePath of Object.keys(byFile).sort()) {
    const fileAnns = byFile[filePath];
    lines.push(`### ${filePath}`);
    lines.push('');
    for (const a of fileAnns) {
      lines.push(`- ${annotationAnchorLabel(a)} [${a.category}]: ${a.content}`);
      const atts = attByAnnotation[a.id] ?? [];
      if (atts.length > 0) {
        lines.push('  - Attachments (readable files on disk):');
        for (const at of atts) lines.push(`    - \`${at.stored_path}\` (${at.original_filename})`);
      }
    }
    lines.push('');
  }

  // AI-authored review notes from `.pr-notes/` (docs/20 §20.8, P5) — fold the
  // generating AI's own rationale/proof into the export for the next session.
  const reviewNoteLines = reviewNotesExportSection(repoRoot, files.map(f => f.file_path));
  if (reviewNoteLines.length > 0) lines.push(...reviewNoteLines);

  // Instructions for AI tools
  lines.push('---');
  lines.push('');
  lines.push('## Instructions for AI Tools');
  lines.push('');
  lines.push('When processing this code review:');
  lines.push('');
  lines.push('1. **bug** and **fix** annotations indicate code that needs to be changed. Apply the suggested fixes.');
  lines.push('2. **style** annotations indicate stylistic preferences. Apply them to the indicated lines and similar patterns nearby.');
  lines.push('3. **pattern-follow** annotations highlight good patterns. Continue using these patterns in new code.');
  lines.push('4. **pattern-avoid** annotations highlight anti-patterns. Refactor the indicated code and avoid the pattern elsewhere.');
  lines.push('5. **remember** annotations are rules/preferences to persist. Update the project\'s AI configuration file (e.g., CLAUDE.md) with these.');
  lines.push('6. **note** annotations are informational context. Consider them but they may not require code changes.');
  lines.push('7. **Attachments** listed under an annotation are real files on disk (screenshots, logs, specs, etc.) — read them from the given path for additional context when acting on that comment.');
  lines.push('');

  const content = lines.join('\n');

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
