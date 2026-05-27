/**
 * Size limits for syntax highlighting. Kept in a dependency-free module (no
 * DOM, no store imports) so the threshold logic can be unit-tested directly
 * without a browser environment.
 *
 * Highlighting a diff line emits one nested `<span>` per token. For a minified
 * bundle, a base64 data-URI, or an SVG/illustration serialized onto a single
 * line, that's tens of thousands of elements injected via `innerHTML`, and
 * laying them all out on one non-wrapping line freezes the main thread for
 * seconds (GB-821 — selecting a ~1 MB single-line SVG locked up the UI).
 * Highlighting is also visually useless on such lines. Above this length the
 * cell is left as a plain text node, mirroring how `charDiff` bails on long
 * lines (`MAX_LINE_LENGTH`) instead of building an O(n*m) LCS table.
 */
export const MAX_HIGHLIGHT_LINE_LENGTH = 30000;

/**
 * Whether a diff line of this text is short enough to syntax-highlight.
 */
export function isHighlightableLength(text: string): boolean {
  return text.length <= MAX_HIGHLIGHT_LINE_LENGTH;
}
