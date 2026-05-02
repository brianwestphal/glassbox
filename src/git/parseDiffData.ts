import type { FileDiff } from './types.js';

/**
 * Parse the JSON-serialized `FileDiff` stored in `review_files.diff_data`.
 * Returns `null` for missing/empty/corrupt input — callers should treat that
 * as "no diff data" rather than ever working with a partially-typed `{}`.
 *
 * Pure: safe to import from both server and client bundles.
 */
export function parseDiffData(raw: string | null | undefined): FileDiff | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as FileDiff;
  } catch {
    return null;
  }
}
