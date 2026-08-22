/**
 * Repo-relative path-traversal defense (doc 14, FR-14.3), shared so the logic
 * lives in ONE place — a hardening change can't silently miss a copy.
 *
 * Two complementary operations over an externally-supplied path:
 * - `sanitizeRelPath` NEUTRALIZES it into a path that can only resolve inside the
 *   repo (used when the result will be written to), and
 * - `escapesRepo` DETECTS a parent-escaping segment so a caller can reject the
 *   path before reading it.
 *
 * Both first slash-normalize and strip leading slashes; they differ only in how
 * they treat a `..` segment (neutralize to `_` vs. flag for rejection).
 */

/** Forward-slash the separators and drop any leading slashes — the shared first
 *  step of both operations. */
function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Normalize a repo-relative path so it can only ever resolve INSIDE the repo:
 * forward slashes, no leading slash, every parent-escaping `..` segment
 * neutralized to `_`, and an empty result replaced with `file`. Use when the
 * returned path will be joined and written to.
 */
export function sanitizeRelPath(path: string): string {
  const rel = normalizeSlashes(path).replace(/(^|\/)\.\.(?=\/|$)/g, '$1_');
  return rel === '' ? 'file' : rel;
}

/**
 * True when `path` contains a parent-escaping `..` segment (after slash
 * normalization). Use to REJECT an externally-supplied path before reading it.
 */
export function escapesRepo(path: string): boolean {
  return /(^|\/)\.\.(\/|$)/.test(normalizeSlashes(path));
}
