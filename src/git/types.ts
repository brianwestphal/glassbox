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
  | { type: 'diff'; pathA: string; pathB: string };
