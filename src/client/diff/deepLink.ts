/**
 * `?file=<path>&line=<n>` deep-link parsing (doc 34, GB-1144).
 *
 * When a review page loads with a `file` query param, the app jumps to that
 * repo-relative file + line (via `navigateToLocation`) instead of auto-selecting
 * the first file. This powers the "open this commit as a review" jump on a
 * review note's origin-commit label: the newly-opened review lands directly on
 * the note's line. Pure + unit-tested so the parsing rules are pinned.
 */
export interface DeepLinkTarget {
  file: string;
  line: number;
}

/**
 * Parse a deep-link target from a URL query string (e.g. `window.location.search`).
 * Returns `null` when no `file` param is present. `line` falls back to 1 when it
 * is missing, non-numeric, or not a positive integer.
 */
export function parseDeepLink(search: string): DeepLinkTarget | null {
  const params = new URLSearchParams(search);
  const file = params.get('file');
  if (file === null || file === '') return null;
  const rawLine = params.get('line');
  const parsed = rawLine !== null ? Number.parseInt(rawLine, 10) : NaN;
  const line = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  return { file, line };
}
