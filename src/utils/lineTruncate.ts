/**
 * Display truncation for pathologically long diff lines.
 *
 * A single diff line longer than this is not reviewable on screen — it only
 * ever comes from minified bundles, base64 data URIs, source maps, or an
 * SVG/illustration serialized onto one line. Rendering its full content puts a
 * multi-hundred-KB text node into the DOM, and laying out + painting that one
 * enormous line freezes the browser's main thread for seconds. The freeze is
 * worst in the macOS WKWebView the desktop app runs in, where real compositing
 * of a multi-million-pixel-wide line is far costlier than a headless browser's
 * (which is why timing-only tests in headless Chromium never caught it).
 *
 * Skipping syntax highlighting alone (see `MAX_HIGHLIGHT_LINE_LENGTH`) is not
 * enough: the plain giant text node still has to be laid out and painted. The
 * only robust fix is to keep the giant content out of the DOM entirely — we
 * render a bounded prefix plus a marker showing how much was elided. Full line
 * content is still available in the stored diff (used for export and
 * annotations, which key off line numbers, not the rendered text).
 *
 * The constant sits at the same threshold as `charDiff`'s `MAX_LINE_LENGTH`:
 * past it we already give up on inline character-level diffing, so a line this
 * long is treated as non-reviewable throughout the viewer. A 5000-char prefix
 * is ~40k px wide — trivial for any engine to lay out and paint.
 */
export const MAX_DIFF_LINE_LENGTH = 5000;

export interface TruncatedLine {
  /** The leading slice that is actually rendered. */
  text: string;
  /** How many characters were elided from the end. */
  hidden: number;
  /** The original, untruncated length. */
  fullLength: number;
}

/**
 * Returns truncation info for a diff line, or `null` when the line is short
 * enough to render in full.
 */
export function truncateDiffLine(content: string): TruncatedLine | null {
  if (content.length <= MAX_DIFF_LINE_LENGTH) return null;
  return {
    text: content.slice(0, MAX_DIFF_LINE_LENGTH),
    hidden: content.length - MAX_DIFF_LINE_LENGTH,
    fullLength: content.length,
  };
}
