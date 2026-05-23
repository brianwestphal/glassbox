import type { FileDiff } from './types.js';
import { FileDiffSchema } from './types.js';

/** Build a structurally-valid empty `FileDiff` for callers that need a
 *  non-null fallback when the stored diff is absent or unparseable. */
export function emptyFileDiff(filePath = ''): FileDiff {
  return {
    filePath,
    oldPath: null,
    status: 'modified',
    hunks: [],
    isBinary: false,
  };
}

/**
 * Parse the JSON-serialized `FileDiff` stored in `review_files.diff_data`.
 * Returns `null` for missing/empty/corrupt input or for JSON that doesn't
 * match the `FileDiff` schema — callers should treat that as "no diff
 * data" rather than ever working with a partially-typed value.
 *
 * Pure: safe to import from both server and client bundles.
 */
export function parseDiffData(raw: string | null | undefined): FileDiff | null {
  if (raw === null || raw === undefined || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = FileDiffSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
