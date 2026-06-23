import { z } from 'zod';

/**
 * Schemas for the file-diff types. These flow through PGLite's
 * `review_files.diff_data` column as JSON-encoded strings and are
 * therefore at the same trust level as any other wire data — we
 * validate when parsing, never `as`-cast a `JSON.parse` result.
 */

export const DiffLineSchema = z.object({
  type: z.enum(['add', 'remove', 'context']),
  oldNum: z.number().nullable(),
  newNum: z.number().nullable(),
  content: z.string(),
});
export type DiffLine = z.infer<typeof DiffLineSchema>;

export const DiffHunkSchema = z.object({
  oldStart: z.number(),
  oldCount: z.number(),
  newStart: z.number(),
  newCount: z.number(),
  lines: z.array(DiffLineSchema),
});
export type DiffHunk = z.infer<typeof DiffHunkSchema>;

/**
 * The on-disk shape of `review_files.diff_data`. Optional/defaulted
 * fields are tolerated because legacy rows (and unit-test fixtures
 * predating zod) may omit them. Defaults keep callers safe without
 * forcing a one-shot migration of every row to the full shape.
 */
export const FileDiffSchema = z.object({
  filePath: z.string().default(''),
  oldPath: z.string().nullable().default(null),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']).default('modified'),
  hunks: z.array(DiffHunkSchema).default([]),
  isBinary: z.boolean().default(false),
});
export type FileDiff = z.infer<typeof FileDiffSchema>;

/**
 * One actual↔expected image pairing in a ground-truth comparison (doc 26). The
 * manifest is loaded once at launch and the resolved entries are carried in the
 * review mode, so the image route and diff builder need no file I/O at request
 * time. `expectedPath` is the old/A side, `actualPath` the new/B side.
 *
 * Defined as a schema so the round-trip through the `reviews.mode` string column
 * (a trust boundary) is validated, not asserted.
 */
export const GroundTruthEntrySchema = z.object({
  /** Stable display + lookup id; carries an image extension so the image viewer
   *  engages (defaults to the actual path as written in the manifest). */
  key: z.string(),
  /** Absolute path to the actual image (new / B side). */
  actualPath: z.string(),
  /** Absolute path to the expected / ground-truth image (old / A side). */
  expectedPath: z.string(),
  /** Optional reviewer-facing label. */
  label: z.string().optional(),
  /** What the expected image represents (display hint only). */
  expectedKind: z.enum(['spec', 'reference', 'previous-actual']).optional(),
});
export type GroundTruthEntry = z.infer<typeof GroundTruthEntrySchema>;

export type ReviewMode =
  | { type: 'uncommitted' }
  | { type: 'staged' }
  | { type: 'unstaged' }
  | { type: 'commit'; sha: string }
  | { type: 'range'; from: string; to: string }
  | { type: 'branch'; name: string }
  | { type: 'files'; patterns: string[] }
  | { type: 'all' }
  // Direct comparison of two arbitrary paths (files or folders), independent
  // of git history and usable outside a repository (doc 18). `pathA` is the
  // old/left side, `pathB` the new/right side; both are absolute paths.
  | { type: 'diff'; pathA: string; pathB: string }
  // Ground-truth image comparison (doc 26): each entry pairs an actual image
  // with an expected/ground-truth image, loaded from a manifest. `comparisons`
  // is the resolved manifest (absolute paths); `manifestPath` is kept for
  // display + re-run matching.
  | { type: 'ground-truth'; manifestPath: string; comparisons: GroundTruthEntry[] };
