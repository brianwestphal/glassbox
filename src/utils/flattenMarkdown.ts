/**
 * Flatten a markdown note body to plain text (doc 20 §20.2).
 *
 * SARIF carries a message in two forms. `markdown` holds the formatted source;
 * `text` is the plain-text form SARIF §3.11.9 requires alongside it, so "the
 * message is viewable even in contexts that do not support the rendering of
 * formatted text" — and §3.11.3 says a plain text message "SHALL NOT contain
 * formatting information". Writing the markdown source into both fields defeats
 * that: a third-party SARIF viewer would show literal `###`, `**`, and fence
 * backticks. This produces the readable fallback instead.
 *
 * It is *not* a markdown parser and has no security role — the rendering path
 * (`renderNoteMarkdown`) is the one with a threat model. Note that this operates
 * on **raw** body text, whereas the renderer's block patterns operate on
 * *escaped* text; the two must not share regexes.
 */

const FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})/;
const HEADING_RE = /^ {0,3}#{1,6}\s+(.*)$/;

/** Drop inline markers, keeping their content. Mirrors the constructs
 *  `renderNoteMarkdown` renders, so the two stay in lockstep. */
function stripInline(line: string): string {
  return line
    .replace(/`([^`]+)`/g, '$1')
    // A link becomes "text (url)" — the destination is information a plain-text
    // reader would otherwise lose entirely.
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/(^|[^_])_([^_\s][^_]*)_/g, '$1$2');
}

/**
 * Render a markdown body as plain text. Headings lose their `#` markers and
 * fenced code loses its fences; list markers, blockquote markers, and thematic
 * breaks are kept — they read as intended in plain text. Code-block contents are
 * passed through untouched, so a `**` inside a snippet survives.
 */
export function flattenMarkdown(body: string): string {
  const out: string[] = [];
  let inFence = false;

  for (const line of body.split('\n')) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    const heading = HEADING_RE.exec(line);
    const text = heading !== null ? heading[1].replace(/\s+#+\s*$/, '') : line;
    out.push(stripInline(text));
  }

  return out.join('\n');
}
