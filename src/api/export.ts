/**
 * Schema for the structured JSON review export (`.glassbox/latest-review.json`,
 * doc 6). A machine-readable companion to `latest-review.md` so an external tool
 * can act on a completed review (e.g. file one ticket per comparison) without
 * parsing the markdown prose. Glassbox produces this; the zod schema is the
 * single source of truth for its shape and the export is `.parse()`d before
 * being written, so a builder bug fails loudly rather than emitting a bad file.
 *
 * Annotations are grouped **by comparison** (review file), since the chosen
 * downstream granularity is one ticket per comparison-with-feedback. Only
 * comparisons that carry at least one annotation are included.
 */
import { z } from 'zod';

/** A rectangle on an image, both as normalized fractions (always present) and
 *  denormalized pixels (present only when the image's natural size is known —
 *  ground-truth comparisons, whose images are on disk). `scope` is mode-neutral:
 *  for a ground-truth review, `old` = the expected/A image, `new` = the actual/B
 *  image, `both` = applies to both. */
export const ExportRegionSchema = z.object({
  normalized: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  pixel: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
  scope: z.enum(['old', 'new', 'both']),
});
export type ExportRegion = z.infer<typeof ExportRegionSchema>;

export const ExportAttachmentSchema = z.object({
  storedPath: z.string(),
  originalFilename: z.string(),
});

export const ExportAnnotationSchema = z.object({
  id: z.string(),
  category: z.string(),
  content: z.string(),
  /** 1-based line, or 0 for an image-level annotation (doc 23). */
  lineNumber: z.number(),
  /** Present only for an image-region annotation (doc 23); null otherwise. */
  region: ExportRegionSchema.nullable(),
  attachments: z.array(ExportAttachmentSchema),
});
export type ExportAnnotation = z.infer<typeof ExportAnnotationSchema>;

/** Ground-truth comparison context (doc 26), present only for ground-truth
 *  reviews. Lets a consumer title/route a ticket meaningfully and read the
 *  expected/actual images off disk. */
export const ExportGroundTruthSchema = z.object({
  label: z.string().optional(),
  expectedKind: z.enum(['spec', 'reference', 'previous-actual']).optional(),
  actualPath: z.string(),
  expectedPath: z.string(),
  differenceScore: z.number().nullable(),
  setLabel: z.string().optional(),
  stepIndex: z.number().optional(),
  stepCount: z.number().optional(),
});
export type ExportGroundTruth = z.infer<typeof ExportGroundTruthSchema>;

export const ExportComparisonSchema = z.object({
  fileId: z.string(),
  path: z.string(),
  status: z.string(),
  /** Ground-truth context, or null for non-ground-truth reviews. */
  groundTruth: ExportGroundTruthSchema.nullable(),
  annotations: z.array(ExportAnnotationSchema),
});
export type ExportComparison = z.infer<typeof ExportComparisonSchema>;

export const ReviewExportSchema = z.object({
  /** Bumped if the shape changes incompatibly, so consumers can guard. */
  schemaVersion: z.literal(1),
  review: z.object({
    id: z.string(),
    repoName: z.string(),
    /** A short human label (e.g. "ground truth: manifest.json"), never the raw
     *  serialized mode string. */
    mode: z.string(),
    /** The raw mode discriminant (e.g. "ground-truth", "uncommitted") so a
     *  consumer can branch without re-deriving it from the label. */
    modeType: z.string(),
    date: z.string(),
    isCurrent: z.boolean(),
  }),
  comparisons: z.array(ExportComparisonSchema),
});
export type ReviewExport = z.infer<typeof ReviewExportSchema>;
