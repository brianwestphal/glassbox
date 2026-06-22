/**
 * Zod schemas for DB row shapes. These are the single source of truth for
 * every row's structure — the `Annotation`, `Review`, `ReviewFile`,
 * `AIAnalysis`, `AIFileScore`, and `UserPreferences` TypeScript types are
 * inferred from these schemas, and the `parseRow*()` helpers validate raw
 * results coming back from PGLite before the rest of the system sees them.
 *
 * Why both schemas and parse helpers? PGLite returns `unknown`-shaped rows
 * — without runtime validation we'd be one schema change away from a
 * silent `undefined.foo`. Validation here means a corrupt or schema-skewed
 * row throws loudly at the boundary rather than crashing far downstream.
 *
 * The shapes mirror the on-disk table layout (snake_case columns, exactly
 * the nullability PostgreSQL stores). Keep them in lockstep with the
 * CREATE TABLE statements in `src/db/connection.ts`.
 */
import { z } from 'zod';

/**
 * PGLite returns `TIMESTAMP` (no time zone) columns as JavaScript `Date`
 * objects constructed from the stored naive timestamp interpreted in the
 * runtime's local time zone. Downstream callers historically treated the
 * column as a `string` containing UTC-relative time (it's what the type
 * interfaces declared and what gets serialized over the wire). This
 * fragment accepts either form and normalizes to an ISO string that
 * actually points at the original UTC moment, undoing PGLite's local-TZ
 * reinterpretation when it produced a `Date`. Without this correction,
 * a server in any non-UTC zone would see every freshly inserted row as
 * hours into the past or future (depending on the offset).
 */
const TimestampSchema = z.union([z.string(), z.date()])
  .transform((v) => {
    if (v instanceof Date) {
      const correctedMs = v.getTime() - v.getTimezoneOffset() * 60 * 1000;
      return new Date(correctedMs).toISOString();
    }
    if (v.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(v)) return v;
    // Naive PG timestamp string — treat as UTC.
    return new Date(v + 'Z').toISOString();
  });

// --- Reviews ---

export const ReviewSchema = z.object({
  id: z.string(),
  repo_path: z.string(),
  repo_name: z.string(),
  mode: z.string(),
  mode_args: z.string().nullable(),
  head_commit: z.string().nullable(),
  status: z.string(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Review = z.infer<typeof ReviewSchema>;

// --- Review files ---

export const ReviewFileSchema = z.object({
  id: z.string(),
  review_id: z.string(),
  file_path: z.string(),
  status: z.string(),
  diff_data: z.string().nullable(),
  created_at: TimestampSchema,
});
export type ReviewFile = z.infer<typeof ReviewFileSchema>;

// --- Annotations ---

/**
 * A rectangular region on an image, in normalized [0,1] fractions of the image's
 * natural dimensions (doc 23). Normalized coords keep a region pinned to the
 * same place on both the A and B sides regardless of display size or zoom. The
 * region is persisted as JSON in the annotation's `region_data` column.
 */
export const ImageRegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type ImageRegion = z.infer<typeof ImageRegionSchema>;

export const AnnotationSchema = z.object({
  id: z.string(),
  // 0 marks an image-level annotation (doc 23): a general image comment, or —
  // when `region_data` is set — a comment anchored to a rectangle on the image.
  // Line-anchored text-diff annotations use the real 1-based line number.
  line_number: z.number(),
  review_file_id: z.string(),
  side: z.string(),
  category: z.string(),
  content: z.string(),
  is_stale: z.boolean(),
  original_content: z.string().nullable(),
  // The SARIF guid of the AI review note this annotation replies to (doc 20
  // threading), or null for a normal annotation. `.default(null)` tolerates
  // rows written before the column existed.
  reply_to_note_id: z.string().nullable().default(null),
  // JSON-encoded {@link ImageRegion} for image-region annotations (doc 23), or
  // null for line annotations and general image comments. `.default(null)`
  // tolerates rows written before the column existed.
  region_data: z.string().nullable().default(null),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const AnnotationWithFilePathSchema = AnnotationSchema.extend({
  file_path: z.string(),
});
export type AnnotationWithFilePath = z.infer<typeof AnnotationWithFilePathSchema>;

// --- AI analyses ---

export const AIAnalysisSchema = z.object({
  id: z.string(),
  review_id: z.string(),
  analysis_type: z.string(),
  status: z.string(),
  error_message: z.string().nullable(),
  progress_completed: z.number(),
  progress_total: z.number(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type AIAnalysis = z.infer<typeof AIAnalysisSchema>;

export const AIFileScoreSchema = z.object({
  id: z.string(),
  analysis_id: z.string(),
  review_file_id: z.string(),
  file_path: z.string(),
  sort_order: z.number(),
  aggregate_score: z.number().nullable(),
  rationale: z.string().nullable(),
  /** JSON-encoded — use `parseJsonColumn(DimensionScoresSchema, …)` to read. */
  dimension_scores: z.string().nullable(),
  /** JSON-encoded — use `parseJsonColumn(FileScoreNotesSchema, …)` to read. */
  notes: z.string().nullable(),
  created_at: TimestampSchema,
});
export type AIFileScore = z.infer<typeof AIFileScoreSchema>;

// --- User preferences ---
//
// The `user_preferences` table allows individual columns to be NULL, but
// `getUserPreferences()` fills in defaults so callers receive a fully
// populated record — the row schema below reflects what callers actually
// see, not the raw column nullability.

export const UserPreferencesSchema = z.object({
  sort_mode: z.string(),
  risk_sort_dimension: z.string(),
  show_risk_scores: z.boolean(),
  ignore_whitespace: z.boolean(),
  svg_view_mode: z.string(),
  last_image_mode: z.string(),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

// --- JSON-column inner shapes (stored as TEXT in PGLite) ---

export const DimensionScoresSchema = z.record(z.string(), z.number());
export type DimensionScores = z.infer<typeof DimensionScoresSchema>;

export const FileScoreNotesSchema = z.object({
  overview: z.string(),
  lines: z.array(z.object({
    line: z.number(),
    content: z.string(),
  })),
});
export type FileScoreNotes = z.infer<typeof FileScoreNotesSchema>;

// --- Parse helpers ---

/** Parse an array of DB rows with the given schema. Throws on the first
 *  validation failure so a schema drift fails loudly at the boundary
 *  rather than producing silent undefineds downstream. */
export function parseRows<T>(schema: z.ZodType<T>, rows: unknown[]): T[] {
  return rows.map((row, idx) => {
    const result = schema.safeParse(row);
    if (!result.success) {
      throw new Error(
        `Row ${String(idx)} failed validation: ${result.error.issues
          .map(i => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`
      );
    }
    return result.data;
  });
}

/** Parse a single DB row (typically from `result.rows[0]`). Returns
 *  `undefined` when the row is missing; throws when present but invalid. */
export function parseRow<T>(schema: z.ZodType<T>, row: unknown): T | undefined {
  if (row === undefined || row === null) return undefined;
  const result = schema.safeParse(row);
  if (!result.success) {
    throw new Error(
      `Row failed validation: ${result.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }
  return result.data;
}

/** Parse a JSON-encoded TEXT column. Returns `null` when the input is
 *  null/undefined or unparseable, or when the parsed JSON doesn't match
 *  the schema — corrupt columns shouldn't 500 the request. */
export function parseJsonColumn<T>(schema: z.ZodType<T>, raw: string | null | undefined): T | null {
  if (raw === null || raw === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}
