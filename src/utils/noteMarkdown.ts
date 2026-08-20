/**
 * A deliberately tiny, **safe** markdown renderer for AI note bodies (doc 20
 * §20.6) — the `.pr-notes/` review notes and the risk/narrative/guided analysis
 * notes. Pure (no DOM/Node deps) so both the server component (`diffView.tsx`)
 * and the client (`aiNotes.tsx`) can use it.
 *
 * Security model: the input is **HTML-escaped first**, so no markup in the note
 * body can ever reach the DOM. The block and inline passes then run over the
 * escaped text and only ever emit a fixed set of tags (`p`, `h4`–`h6`, `ul`,
 * `ol`, `li`, `pre`, `code`, `blockquote`, `hr`, `strong`, `em`, `a`, `br`).
 * Dynamic attributes are limited to a link `href`, gated to http(s)/mailto URLs
 * so `javascript:`/`data:` links degrade to plain text, and an embedded link's
 * `data-loc-*` target, which is attribute-escaped because it arrives from SARIF
 * rather than from the escaped body. The result is therefore safe to pass to
 * `raw()`.
 *
 * This is also what SARIF §3.11.4 asks of a consumer that renders formatted
 * messages ("disable HTML processing … or run the resulting HTML through an
 * HTML sanitizer") — satisfied here by construction rather than by a sanitizer
 * pass, which is why a full markdown library is deliberately not used.
 *
 * The supported subset is documented for producers in
 * `src/review-notes/instructions.ts`; see that text before adding to it.
 */

import { raw, type SafeHtml } from 'kerfjs';
import { html } from 'kerfjs/html';

/** Only these schemes are allowed for rendered links. */
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/**
 * A code location an embedded link can point at (SARIF `relatedLocations`).
 * Kept structural rather than importing the review-notes type so this module
 * stays free of feature dependencies.
 */
export interface NoteLinkTarget {
  uri: string;
  line: number;
}

/** Per-render context threaded to the inline pass. */
interface RenderContext {
  related: NoteLinkTarget[];
}

/**
 * SARIF §3.11.6 "embedded link": a link whose destination is a non-negative
 * integer indexing `result.relatedLocations`. Resolve it to a jump-to-line
 * anchor the client's delegate picks up; an index with no usable target falls
 * back to literal text, so a malformed note degrades rather than producing a
 * dead link.
 */
function renderEmbeddedLink(text: string, destination: string, ctx: RenderContext): string | null {
  // `\d+` only, so `.at()` can never be handed a negative (wrapping) index.
  if (!/^\d+$/.test(destination)) return null;
  const target = ctx.related.at(Number(destination));
  if (target === undefined || target.uri === '' || target.line < 1) return null;
  // `related` arrives from SARIF and is NOT part of the escaped body, so escape
  // its values (via kerf's `html` text-hole escaping — a safe superset of what a
  // double-quoted attribute needs) before placing them in the attributes below.
  // `text` is already-processed inline HTML, so it stays as-is.
  const file = html`${target.uri}`.toString();
  const title = html`${`${target.uri}:${String(target.line)}`}`.toString();
  return `<a class="ai-note-loclink" data-loc-file="${file}" data-loc-line="${String(target.line)}" title="${title}">${text}</a>`;
}

/** Apply inline markdown to a single already-escaped line. */
function renderInline(escaped: string, ctx: RenderContext): string {
  // Code spans first, so their contents aren't further formatted.
  let out = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links [text](dest) — an integer destination is a SARIF embedded link; a URL
  // must use a safe scheme. Anything else stays literal text.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text: string, url: string) => {
    const embedded = renderEmbeddedLink(text, url, ctx);
    if (embedded !== null) return embedded;
    if (!SAFE_URL.test(url)) return match;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Bold before italic so `**x**` isn't mistaken for two italics.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_\s][^_]*)_/g, '$1<em>$2</em>');

  return out;
}

// --- Block pass -------------------------------------------------------------

/**
 * Nesting limit for lists and blockquotes. SARIF §3.11.4 warns that deeply
 * nested markup can overflow a markdown processor's stack and requires
 * consumers to be hardened against it; a depth cap is that hardening. Past the
 * cap the remaining lines still render — as paragraphs, without recursing.
 */
const MAX_BLOCK_DEPTH = 6;

/**
 * Headings start at `h4`. A note is embedded content inside a diff row, so its
 * headings must never outrank the page's own chrome; relative depth is kept by
 * shifting, and levels past `h6` clamp there.
 */
const HEADING_BASE = 3;

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*)$/;
const HR_RE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
// The block pass runs over *escaped* text, so a blockquote's `>` marker has
// already become `&gt;`. Matching the raw character here would silently never
// fire — this is the one place escape-first leaks into a block pattern.
const QUOTE_RE = /^ {0,3}&gt;[ \t]?(.*)$/;
const ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
/** A continuation line of a list item: indented, non-blank. */
const CONTINUATION_RE = /^\s{2,}\S/;

interface ListItemMatch {
  indent: number;
  ordered: boolean;
  /** `start` of an ordered list, taken from its first item. */
  number: number;
  text: string;
}

function matchItem(line: string): ListItemMatch | null {
  const m = ITEM_RE.exec(line);
  if (m === null) return null;
  // A thematic break (`- - -`) also matches the bullet pattern; it isn't a list.
  if (HR_RE.test(line)) return null;
  const ordered = /^\d/.test(m[2]);
  return {
    indent: m[1].length,
    ordered,
    number: ordered ? parseInt(m[2], 10) : 1,
    text: m[3],
  };
}

function isBlockStart(line: string): boolean {
  return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line)
    || QUOTE_RE.test(line) || matchItem(line) !== null;
}

/** Strip the common leading indent from a block of lines. */
function dedent(lines: string[]): string[] {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    min = Math.min(min, line.length - line.trimStart().length);
  }
  if (min === Infinity || min === 0) return lines;
  return lines.map(line => (line.trim() === '' ? '' : line.slice(min)));
}

function renderParagraph(lines: string[], ctx: RenderContext): string {
  // A single newline inside a paragraph stays a visible break rather than
  // collapsing to a space as GFM would: note bodies are written as short,
  // line-oriented prose and their authors mean the breaks they type.
  return `<p>${lines.map(line => renderInline(line, ctx)).join('<br>')}</p>`;
}

function renderCodeBlock(lines: string[]): string {
  return `<pre><code>${lines.join('\n')}</code></pre>`;
}

/** Render one run of list lines. `first` is the run's opening item, matched by
 *  the caller (which is how it knew this was a list at all). */
function renderList(run: string[], first: ListItemMatch, depth: number, ctx: RenderContext): string {
  const base = first.indent;
  const items: { lines: string[]; nested: string[] }[] = [];

  for (const line of run) {
    const m = matchItem(line);
    if (m !== null && m.indent <= base) {
      items.push({ lines: [m.text], nested: [] });
      continue;
    }
    const item = items[items.length - 1];
    // Everything else belongs to the open item: a deeper item, an indented
    // continuation, or a blank separator. It is buffered verbatim and rendered
    // as its own nested block, so a fence or sub-list inside an item works.
    if (item.nested.length > 0 || m !== null) item.nested.push(line);
    else if (line.trim() === '') item.nested.push(line);
    else item.lines.push(line.trim());
  }

  const tag = first.ordered ? 'ol' : 'ul';
  const start = first.ordered && first.number !== 1 ? ` start="${String(first.number)}"` : '';
  const body = items.map(item => {
    const text = item.lines.map(line => renderInline(line, ctx)).join('<br>');
    const nested = dedent(item.nested).filter((l, i, a) => !(l === '' && i === a.length - 1));
    const inner = nested.length > 0 ? renderBlocks(nested, depth + 1, ctx) : '';
    return `<li>${text}${inner}</li>`;
  }).join('');
  return `<${tag}${start}>${body}</${tag}>`;
}

/**
 * Render already-escaped lines as block-level HTML. Recursion (list items,
 * blockquotes) is bounded by `MAX_BLOCK_DEPTH`.
 */
function renderBlocks(lines: string[], depth: number, ctx: RenderContext): string {
  if (depth > MAX_BLOCK_DEPTH) {
    const text = lines.filter(l => l.trim() !== '');
    return text.length > 0 ? renderParagraph(text, ctx) : '';
  }

  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence !== null) {
      const marker = fence[1][0];
      const body: string[] = [];
      i++;
      // An unterminated fence runs to the end of the body — the same lenient
      // reading CommonMark specifies, and the common case when a note is
      // truncated.
      while (i < lines.length) {
        const close = FENCE_RE.exec(lines[i]);
        if (close !== null && close[1][0] === marker && close[2] === '') { i++; break; }
        body.push(lines[i]);
        i++;
      }
      out.push(renderCodeBlock(body));
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      const level = Math.min(6, heading[1].length + HEADING_BASE);
      out.push(`<h${String(level)}>${renderInline(heading[2].replace(/\s+#+\s*$/, ''), ctx)}</h${String(level)}>`);
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote !== null) {
      const inner: string[] = [];
      while (i < lines.length) {
        const m = QUOTE_RE.exec(lines[i]);
        if (m === null) break;
        inner.push(m[1]);
        i++;
      }
      out.push(`<blockquote>${renderBlocks(inner, depth + 1, ctx)}</blockquote>`);
      continue;
    }

    const item = matchItem(line);
    if (item !== null) {
      const run: string[] = [];
      while (i < lines.length) {
        const current = lines[i];
        if (current.trim() === '') {
          // A blank line only stays inside the list when list content follows.
          let k = i;
          while (k < lines.length && lines[k].trim() === '') k++;
          if (k < lines.length && (matchItem(lines[k]) !== null || CONTINUATION_RE.test(lines[k]))) {
            run.push(...lines.slice(i, k));
            i = k;
            continue;
          }
          break;
        }
        if (matchItem(current) === null && !CONTINUATION_RE.test(current)) break;
        run.push(current);
        i++;
      }
      out.push(renderList(run, item, depth, ctx));
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !(para.length > 0 && isBlockStart(lines[i]))) {
      para.push(lines[i]);
      i++;
    }
    out.push(renderParagraph(para, ctx));
  }

  return out.join('');
}

/**
 * Render an AI note body to safe HTML. Supports paragraphs, ATX headings
 * (rendered `h4`–`h6`), unordered/ordered lists with nesting, fenced code
 * blocks, blockquotes, thematic breaks, and the inline set (code, bold, italic,
 * http(s)/mailto links). Everything else is escaped literal text.
 */
export function renderNoteMarkdown(text: string, related: NoteLinkTarget[] = []): SafeHtml {
  // Escape the whole body first (via kerf's `html` text-hole escaping), then the
  // block renderer parses markdown structure on the escaped text, inserting only
  // trusted markup around it. Returning SafeHtml puts the trust boundary HERE —
  // the single point that escapes every user value — so callers embed the result
  // directly (`{renderNoteMarkdown(...)}`) with no escape hatch of their own. The
  // one `raw()` below is that boundary: the string is assembled from leaves each
  // escaped through `html`, so it is safe HTML by construction.
  // eslint-disable-next-line kerfjs/no-raw-with-dynamic-arg -- single trusted-assembly point; every user value is escaped at the leaves via kerfjs/html
  return raw(renderBlocks(html`${text}`.toString().split('\n'), 0, { related }));
}
