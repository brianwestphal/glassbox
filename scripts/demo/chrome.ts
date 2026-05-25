/**
 * SVG compositing helpers for the demo: wraps each captured frame in faux
 * window chrome (browser or terminal) and draws a lower caption band. Used by
 * `capture-demo.ts` at compose time.
 *
 * Layout (all px, on the final canvas):
 *   ┌─ MARGIN_TOP ─────────────────────────────┐
 *   │  ╭─ title bar (TITLE_H) ──────────────╮   │  ← traffic lights + title
 *   │  │                                    │   │
 *   │  │   captured content (CONTENT_W×H)   │   │
 *   │  ╰────────────────────────────────────╯   │
 *   │            caption band (CAPTION_H)        │
 *   └────────────────────────────────────────────┘
 *
 * Captured content is rendered at CONTENT_W×CONTENT_H, then translated by
 * (OX, OY) inside the card. Overlay/cursor coordinates measured in content
 * space must therefore be shifted by (OX, OY) — `capture-demo.ts` does this.
 */

const MARGIN_X = 24;
const MARGIN_TOP = 24;
const TITLE_H = 38;
const CAPTION_H = 56;

export const CONTENT_W = 1280;
export const CONTENT_H = 800;

/** Top-left of the captured content within the final canvas. */
export const OX = MARGIN_X;
export const OY = MARGIN_TOP + TITLE_H;

export const CANVAS_W = CONTENT_W + MARGIN_X * 2; // 1328
export const CANVAS_H = MARGIN_TOP + TITLE_H + CONTENT_H + CAPTION_H; // 918

const CARD_W = CONTENT_W;
const CARD_H = TITLE_H + CONTENT_H;
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Square-top, rounded-bottom clip for the content area (top meets the title bar). */
function contentClipPath(): string {
  const x0 = OX;
  const y0 = OY;
  const x1 = OX + CONTENT_W;
  const y1 = OY + CONTENT_H;
  const r = 11;
  return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} L ${x0 + r} ${y1} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} Z`;
}

export type ChromeKind = 'browser' | 'terminal';

export interface ChromeOpts {
  title: string;
  kind: ChromeKind;
  /** Unique id suffix so multi-frame clip-path ids don't collide. */
  id: string;
  /** Optional caption shown in the band below the window. */
  caption?: string;
}

/** Wrap captured content SVG in window chrome + caption, returning full-canvas markup. */
export function chromeWrap(contentSvg: string, opts: ChromeOpts): string {
  const { title, kind, id, caption } = opts;
  const barFill = kind === 'terminal' ? '#161b22' : '#2a2f3a';
  const titleFill = kind === 'terminal' ? '#768390' : '#cdd3de';
  const clipId = `cclip-${id}`;
  const shadowId = `csh-${id}`;

  const lightsY = MARGIN_TOP + TITLE_H / 2;
  const lights =
    `<circle cx="${MARGIN_X + 20}" cy="${lightsY}" r="6.5" fill="#ff5f57"/>` +
    `<circle cx="${MARGIN_X + 42}" cy="${lightsY}" r="6.5" fill="#febc2e"/>` +
    `<circle cx="${MARGIN_X + 64}" cy="${lightsY}" r="6.5" fill="#28c840"/>`;

  const titleText =
    `<text x="${CANVAS_W / 2}" y="${lightsY + 4.5}" text-anchor="middle" ` +
    `font-family="${SANS}" font-size="13" fill="${titleFill}">${esc(title)}</text>`;

  return (
    `<rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="#0a0c10"/>` +
    `<defs>` +
    `<clipPath id="${clipId}"><path d="${contentClipPath()}"/></clipPath>` +
    `<filter id="${shadowId}" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="10" stdDeviation="22" flood-color="#000000" flood-opacity="0.45"/></filter>` +
    `</defs>` +
    `<rect x="${MARGIN_X}" y="${MARGIN_TOP}" width="${CARD_W}" height="${CARD_H}" rx="12" ry="12" ` +
    `fill="${barFill}" filter="url(#${shadowId})"/>` +
    lights +
    titleText +
    `<g clip-path="url(#${clipId})"><g transform="translate(${OX}, ${OY})">${contentSvg}</g></g>` +
    (caption !== undefined && caption !== '' ? captionMarkup(caption, id) : '')
  );
}

/** A centered caption in the band below the window. */
function captionMarkup(text: string, id: string): string {
  const cy = MARGIN_TOP + TITLE_H + CONTENT_H + CAPTION_H / 2;
  const shadowId = `tsh-${id}`;
  return (
    `<defs><filter id="${shadowId}" x="-20%" y="-40%" width="140%" height="180%">` +
    `<feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000000" flood-opacity="0.7"/></filter></defs>` +
    `<text x="${CANVAS_W / 2}" y="${cy + 7}" text-anchor="middle" font-family="${SANS}" ` +
    `font-size="21" font-weight="600" fill="#e8edf4" filter="url(#${shadowId})">${esc(text)}</text>`
  );
}
