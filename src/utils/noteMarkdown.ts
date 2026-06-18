/**
 * A deliberately tiny, **safe** inline-markdown renderer for AI note bodies
 * (doc 20 §20.6; GB-909) — review notes and the risk/narrative/guided analysis
 * notes. Pure (no DOM/Node deps) so both the server component (`diffView.tsx`)
 * and the client (`aiNotes.tsx`) can use it.
 *
 * Security model: the input is **HTML-escaped first**, so no markup in the note
 * body can ever reach the DOM. The markdown pass then runs over the escaped
 * text and only ever emits a fixed set of tags (`code`, `strong`, `em`, `a`,
 * `br`) — the one dynamic attribute, a link `href`, is gated to http(s)/mailto
 * URLs, so `javascript:`/`data:` links degrade to plain text. The result is
 * therefore safe to pass to `raw()`.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Only these schemes are allowed for rendered links. */
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** Apply inline markdown to a single already-escaped line. */
function renderInline(escaped: string): string {
  // Code spans first, so their contents aren't further formatted.
  let out = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links [text](url) — only safe schemes; otherwise leave the literal text.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text: string, url: string) => {
    if (!SAFE_URL.test(url)) return match;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Bold before italic so `**x**` isn't mistaken for two italics.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_\s][^_]*)_/g, '$1<em>$2</em>');

  return out;
}

/**
 * Render an AI note body to safe HTML. Supports inline code, bold, italic, and
 * http(s)/mailto links; newlines become `<br>`. Everything else is escaped
 * literal text.
 */
export function renderNoteMarkdown(text: string): string {
  return escapeHtml(text).split('\n').map(renderInline).join('<br>');
}
