import type {
  ExportAnnotation,
  ExportComparison,
  ExportGroundTruth,
  ExportRegion,
  ReviewExport,
} from '../api/export.js';
import { ReviewExportSchema } from '../api/export.js';
import type { AnnotationWithFilePath, Attachment, Review, ReviewFile } from '../db/schemas.js';
import { ImageRegionSchema } from '../db/schemas.js';
import type { GroundTruthEntry, ReviewMode } from '../git/types.js';

/** Natural pixel dimensions of an image, or null when unknown/unresolvable. */
export type ImageDims = { width: number; height: number } | null;

interface BuildArgs {
  review: Review;
  files: ReviewFile[];
  annotations: AnnotationWithFilePath[];
  attachments: Array<Attachment & { file_path: string; line_number: number }>;
  mode: ReviewMode;
  /** Short human label for the review mode (see formatReviewMode). */
  modeLabel: string;
  date: string;
  isCurrent: boolean;
  /** Resolve an image's natural size from its absolute path (header read). Pure
   *  builder stays testable by taking this as a parameter; returns null when the
   *  size can't be determined (no path / undecodable format / non-ground-truth). */
  resolveDims: (absPath: string) => ImageDims;
}

/**
 * Build the structured JSON review export (doc 6). Pure — all I/O (DB reads,
 * image-dimension lookups) is done by the caller and passed in — so it is unit-
 * testable without a database or filesystem. Annotations are grouped by
 * comparison (review file); only comparisons with at least one annotation are
 * emitted. The result is validated against {@link ReviewExportSchema} so a bug
 * here surfaces immediately.
 */
export function buildReviewExportData(args: BuildArgs): ReviewExport {
  const { review, files, annotations, attachments, mode, modeLabel, date, isCurrent, resolveDims } = args;

  // Ground-truth comparison lookup by key (= review file path), when applicable.
  const gtByKey = new Map<string, GroundTruthEntry>();
  if (mode.type === 'ground-truth') {
    for (const c of mode.comparisons) gtByKey.set(c.key, c);
  }

  // Attachments grouped by their annotation id.
  const attByAnnotation = new Map<string, Array<Attachment & { file_path: string; line_number: number }>>();
  for (const at of attachments) {
    const list = attByAnnotation.get(at.annotation_id) ?? [];
    list.push(at);
    attByAnnotation.set(at.annotation_id, list);
  }

  // Annotations grouped by their file path.
  const annByPath = new Map<string, AnnotationWithFilePath[]>();
  for (const a of annotations) {
    const list = annByPath.get(a.file_path) ?? [];
    list.push(a);
    annByPath.set(a.file_path, list);
  }

  // Per-export cache so the same image's header is read at most once.
  const dimsCache = new Map<string, ImageDims>();
  const dimsFor = (absPath: string): ImageDims => {
    if (dimsCache.has(absPath)) return dimsCache.get(absPath) ?? null;
    const dims = resolveDims(absPath);
    dimsCache.set(absPath, dims);
    return dims;
  };

  const comparisons: ExportComparison[] = [];
  for (const file of files) {
    const fileAnns = annByPath.get(file.file_path);
    if (fileAnns === undefined || fileAnns.length === 0) continue; // only annotated comparisons

    const gt = gtByKey.get(file.file_path);
    const groundTruth: ExportGroundTruth | null = gt
      ? {
          ...(gt.label !== undefined ? { label: gt.label } : {}),
          ...(gt.expectedKind !== undefined ? { expectedKind: gt.expectedKind } : {}),
          actualPath: gt.actualPath,
          expectedPath: gt.expectedPath,
          differenceScore: file.difference_score ?? null,
          ...(gt.setLabel !== undefined ? { setLabel: gt.setLabel } : {}),
          ...(gt.stepIndex !== undefined ? { stepIndex: gt.stepIndex } : {}),
          ...(gt.stepCount !== undefined ? { stepCount: gt.stepCount } : {}),
        }
      : null;

    const exported: ExportAnnotation[] = fileAnns.map(a => ({
      id: a.id,
      category: a.category,
      content: a.content,
      lineNumber: a.line_number,
      region: buildRegion(a, gt, dimsFor),
      attachments: (attByAnnotation.get(a.id) ?? []).map(at => ({
        storedPath: at.stored_path,
        originalFilename: at.original_filename,
      })),
    }));

    comparisons.push({ fileId: file.id, path: file.file_path, status: file.status, groundTruth, annotations: exported });
  }

  return ReviewExportSchema.parse({
    schemaVersion: 1,
    review: {
      id: review.id,
      repoName: review.repo_name,
      mode: modeLabel,
      modeType: mode.type,
      date,
      isCurrent,
    },
    comparisons,
  });
}

/** Build the region for an image-region annotation (doc 23), denormalizing to
 *  pixels when the relevant image's natural size is resolvable. Returns null for
 *  line annotations, general image comments, and note-artifact reply regions
 *  (whose `region_data` is a JSON array, not a single rectangle). */
function buildRegion(
  a: AnnotationWithFilePath,
  gt: GroundTruthEntry | undefined,
  dimsFor: (absPath: string) => ImageDims,
): ExportRegion | null {
  if (a.line_number !== 0 || a.region_data === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(a.region_data);
  } catch {
    return null;
  }
  const parsed = ImageRegionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { x, y, w, h, side, artifact } = parsed.data;
  // Note-artifact regions (doc 25) aren't image-comparison regions — skip.
  if (artifact !== undefined) return null;

  const scope = side ?? 'both';
  let pixel: ExportRegion['pixel'] = null;
  if (gt !== undefined) {
    // old → expected image, new/both → actual image (the thing under review).
    const path = side === 'old' ? gt.expectedPath : gt.actualPath;
    const dims = dimsFor(path);
    if (dims !== null) {
      pixel = {
        x: Math.round(x * dims.width),
        y: Math.round(y * dims.height),
        w: Math.round(w * dims.width),
        h: Math.round(h * dims.height),
      };
    }
  }
  return { normalized: { x, y, w, h }, pixel, scope };
}
