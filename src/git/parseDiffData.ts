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

/** Build an `unchanged` `FileDiff` whose single hunk shows the whole current
 *  file as context lines. Used for files pulled into a review only because they
 *  carry AI review notes (doc 20 §20.6, GB-1137): rendering every line as
 *  context lets the notes anchor at their exact line while the sidebar labels
 *  the file `unchanged`. An empty file yields an empty hunk list (nothing to
 *  show) but still a valid `unchanged` diff. */
export function unchangedFileDiff(filePath: string, content: string): FileDiff {
  // An empty file is zero lines (not one empty line, which `''.split('\n')` would
  // yield). Split on \n and drop a single trailing empty segment from a final
  // newline, so a file ending in "\n" doesn't render a phantom blank last line.
  const parts = content === '' ? [] : content.split('\n');
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  const lines = parts.map((text, i) => ({
    type: 'context' as const,
    oldNum: i + 1,
    newNum: i + 1,
    content: text,
  }));
  return {
    filePath,
    oldPath: null,
    status: 'unchanged',
    hunks: lines.length === 0
      ? []
      : [{ oldStart: 1, oldCount: lines.length, newStart: 1, newCount: lines.length, lines }],
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
