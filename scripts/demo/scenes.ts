/**
 * Self-contained HTML scenes used by `capture-demo.ts`: the exported-review
 * markdown peek (`markdownPeekHtml`) and the branded closing card (`endCardSvg`).
 *
 * Rendered headlessly by Playwright and captured by domotion, so they only need
 * to look right at the capture viewport size — no client JS, no interactivity.
 * (The terminal beats — the CLI launch and the Claude Code `/glassbox` session —
 * are now real `domotion term` cast renders; see `casts.ts`.)
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CARD } from './chrome.js';

const SCENES_DIR = dirname(fileURLToPath(import.meta.url));

/** The official Glassbox app icon as a base64 data URI, loaded once. Used on the
 *  closing card so the outro shows the real app mark rather than a wordmark. */
let appIconDataUri: string | null = null;
function appIcon(): string {
  if (appIconDataUri === null) {
    const png = readFileSync(resolve(SCENES_DIR, '../../assets/favicon_512.png'));
    appIconDataUri = `data:image/png;base64,${png.toString('base64')}`;
  }
  return appIconDataUri;
}

// GitHub-dark-adjacent palette shared by the markdown peek (and historically the
// terminal mock, now a real cast render — see `casts.ts`).
const COLOR = {
  bg: '#0d1117',
  text: '#c9d1d9',
  dim: '#6e7681',
  welcome: '#e8a87c', // the ✻ glyph — Claude's terracotta
  border: '#30363d',
  command: '#79c0ff', // slash command
  tool: '#58a6ff', // ● action bullets
  toolName: '#d2a8ff', // Read(...) / Update(...) tool names
  add: '#3fb950',
  remove: '#f85149',
  addBg: 'rgba(63,185,80,0.15)',
  removeBg: 'rgba(248,81,73,0.15)',
} as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Markdown peek -------------------------------------------------------

/** Lightweight line-based markdown → HTML for the exported-review peek. Not a
 *  full parser — just enough to read the structure faithfully. */
function renderMarkdown(md: string, maxLines: number): string {
  const inline = (s: string): string =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<span class="code">$1</span>');
  const out: string[] = [];
  for (const raw of md.split('\n').slice(0, maxLines)) {
    const line = raw.replace(/\s+$/, '');
    if (line === '') out.push('<div class="mdgap"></div>');
    else if (line.startsWith('### ')) out.push(`<div class="h3">${inline(line.slice(4))}</div>`);
    else if (line.startsWith('## ')) out.push(`<div class="h2">${inline(line.slice(3))}</div>`);
    else if (line.startsWith('# ')) out.push(`<div class="h1">${inline(line.slice(2))}</div>`);
    else if (line.startsWith('> ')) out.push(`<div class="quote">${inline(line.slice(2))}</div>`);
    else if (line.startsWith('---')) out.push(`<div class="hr"></div>`);
    else if (/^[-*] /.test(line)) out.push(`<div class="li">${inline(line.slice(2))}</div>`);
    else out.push(`<div class="p">${inline(line)}</div>`);
  }
  return out.join('\n');
}

export interface MarkdownPeekOptions {
  width: number;
  height: number;
  markdown: string;
}

/** A faux file view of the exported `.glassbox/latest-review.md`. */
export function markdownPeekHtml(opts: MarkdownPeekOptions): string {
  const { width, height, markdown } = opts;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${String(width)}px; height: ${String(height)}px;
    background: ${COLOR.bg}; color: ${COLOR.text}; overflow: hidden;
    font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 14px; line-height: 1.6;
  }
  .doc { padding: 40px 56px; }
  .h1 { font-size: 26px; font-weight: 700; color: ${COLOR.text}; margin-bottom: 4px; }
  .h2 { font-size: 18px; font-weight: 700; color: ${COLOR.command}; margin: 18px 0 4px; }
  .h3 { font-size: 15px; font-weight: 600; color: ${COLOR.toolName}; margin: 12px 0 2px; }
  .li { padding-left: 18px; text-indent: -18px; color: ${COLOR.text}; }
  .li::before { content: "•  "; color: ${COLOR.dim}; }
  .p { color: ${COLOR.text}; }
  .quote { color: ${COLOR.dim}; font-style: italic; border-left: 3px solid ${COLOR.border}; padding-left: 12px; }
  .code { color: ${COLOR.add}; }
  .mdgap { height: 9px; }
  .hr { height: 1px; background: ${COLOR.border}; margin: 14px 0; }
  b { color: ${COLOR.welcome}; font-weight: 600; }
</style></head>
<body><div class="doc">${renderMarkdown(markdown, 34)}</div></body></html>`;
}

// --- End card ------------------------------------------------------------

/** Branded closing card as hand-built SVG markup. Floats as a rounded card in
 *  the same window-frame rect as the captured beats (transparent outside it), so
 *  the outro matches the floating-window aesthetic. Hand-built so its text uses
 *  valid single-quoted font-families and never trips domotion's
 *  `<text>`-fallback double-quote bug. Renders in the viewer's system font —
 *  fine for branding. */
export function endCardSvg(): string {
  const { x, y, w, h, r } = CARD;
  const cx = x + w / 2;
  const sans = "-apple-system, 'Segoe UI', system-ui, sans-serif";
  const mono = "ui-monospace, 'SF Mono', Menlo, monospace";
  // Wordmark color: a single constant color (the app icon supplies the brand
  // color, so the wordmark itself is one flat tone — no two-tone "Glass"+"box").
  const wordmarkFill = '#f0f4fa';
  // The official app icon (favicon_512 is 512×580). Shown above the wordmark.
  const iconH = 132;
  const iconW = Math.round(iconH * 512 / 580); // 117
  // Center the branding block (icon → wordmark → tagline → eyebrow → pill → url)
  // within the card. yMark is the wordmark baseline; the icon sits above it.
  const yMark = Math.round(y + h / 2 - 12);
  const iconY = yMark - 214;
  const iconX = Math.round(cx - iconW / 2);
  const pillW = 232;
  const pillX = Math.round(cx - pillW / 2);
  const pillY = yMark + 132;
  return (
    `<defs><linearGradient id="endbg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#19223400"/><stop offset="0.55" stop-color="#0b0e14"/></linearGradient></defs>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#0b0e14"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#172033"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="url(#endbg)"/>` +
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${r - 0.5}" ry="${r - 0.5}" ` +
    `fill="none" stroke="#ffffff" stroke-opacity="0.10"/>` +
    `<image x="${iconX}" y="${iconY}" width="${iconW}" height="${iconH}" href="${appIcon()}" ` +
    `preserveAspectRatio="xMidYMid meet"/>` +
    `<text x="${cx}" y="${yMark}" text-anchor="middle" font-family="${sans}" font-size="70" font-weight="700" ` +
    `letter-spacing="-1.5" fill="${wordmarkFill}">Glassbox</text>` +
    `<text x="${cx}" y="${yMark + 52}" text-anchor="middle" font-family="${sans}" font-size="24" fill="#aab4c2">` +
    `Review AI-generated code. Annotate. Let your AI apply the fix.</text>` +
    `<text x="${cx}" y="${yMark + 90}" text-anchor="middle" font-family="${sans}" font-size="13" ` +
    `letter-spacing="3" fill="#6e7681">↻&#160;&#160;THE REVIEW LOOP</text>` +
    `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="50" rx="11" fill="#1b2230" stroke="#30384a"/>` +
    `<text x="${cx}" y="${pillY + 32}" text-anchor="middle" font-family="${mono}" font-size="19" fill="#e8edf4">` +
    `<tspan fill="#3fb950">$</tspan> npx glassbox</text>` +
    `<text x="${cx}" y="${pillY + 92}" text-anchor="middle" font-family="${sans}" font-size="16" fill="#8b96a6">` +
    `github.com/brianwestphal/glassbox</text>`
  );
}
