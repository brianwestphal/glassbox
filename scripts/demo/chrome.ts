/**
 * SVG compositing helpers for the demo: wraps each captured frame in faux
 * window chrome (browser or terminal) and draws a broadcast-style lower-third
 * caption. Used by `capture-demo.ts` at compose time.
 *
 * The canvas background is **transparent** — the window floats on whatever the
 * embedding page (GitHub README, light or dark) puts behind it. The window has
 * rounded corners and a hairline border (no drop shadow — a shadow would be
 * clipped by the tight canvas margins); the caption is a left-anchored
 * lower-third pill (accent bar + brand eyebrow + caption) rather than a plain
 * centered line.
 *
 * Layout (all px, on the final canvas):
 *   ┌─ MARGIN_TOP ─────────────────────────────┐   (transparent)
 *   │  ╭─ title bar (TITLE_H) ──────────────╮   │  ← traffic lights + title
 *   │  │                                    │   │
 *   │  │   captured content (CONTENT_W×H)   │   │
 *   │  ╰────────────────────────────────────╯   │
 *   │  ▌ lower-third pill (CAPTION_H) ─┐         │
 *   └────────────────────────────────────────────┘
 *
 * Captured content is rendered at CONTENT_W×CONTENT_H, then translated by
 * (OX, OY) inside the card. Overlay/cursor coordinates measured in content
 * space must therefore be shifted by (OX, OY) — `capture-demo.ts` does this.
 */

const MARGIN_X = 24;
const MARGIN_TOP = 24;
const TITLE_H = 38;
const CAPTION_H = 84;

export const CONTENT_W = 1280;
export const CONTENT_H = 800;

/** Top-left of the captured content within the final canvas. */
export const OX = MARGIN_X;
export const OY = MARGIN_TOP + TITLE_H;

export const CANVAS_W = CONTENT_W + MARGIN_X * 2; // 1328
export const CANVAS_H = MARGIN_TOP + TITLE_H + CONTENT_H + CAPTION_H;

const CARD_W = CONTENT_W;
const CARD_H = TITLE_H + CONTENT_H;
const CARD_R = 14;

/** The floating window-card rect, shared so the end card can match the frames. */
export const CARD = { x: MARGIN_X, y: MARGIN_TOP, w: CARD_W, h: CARD_H, r: CARD_R } as const;

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const ACCENT = '#79c0ff';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Square-top, rounded-bottom clip for the content area (top meets the title bar). */
function contentClipPath(): string {
  const x0 = OX;
  const y0 = OY;
  const x1 = OX + CONTENT_W;
  const y1 = OY + CONTENT_H;
  const r = 13;
  return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} L ${x0 + r} ${y1} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} Z`;
}

export type ChromeKind = 'browser' | 'terminal';

export interface ChromeOpts {
  title: string;
  kind: ChromeKind;
  /** Unique id suffix so multi-frame clip-path ids don't collide. */
  id: string;
  /** Optional caption shown in the lower-third below the window. */
  caption?: string;
}

/** Wrap captured content SVG in window chrome + lower-third, returning full-canvas markup. */
export function chromeWrap(contentSvg: string, opts: ChromeOpts): string {
  const { title, kind, id, caption } = opts;
  const barFill = kind === 'terminal' ? '#161b22' : '#22272e';
  const titleFill = kind === 'terminal' ? '#768390' : '#cdd3de';
  const clipId = `cclip-${id}`;

  const lightsY = MARGIN_TOP + TITLE_H / 2;
  const lights =
    `<circle cx="${MARGIN_X + 20}" cy="${lightsY}" r="6.5" fill="#ff5f57"/>` +
    `<circle cx="${MARGIN_X + 42}" cy="${lightsY}" r="6.5" fill="#febc2e"/>` +
    `<circle cx="${MARGIN_X + 64}" cy="${lightsY}" r="6.5" fill="#28c840"/>`;

  const titleText =
    `<text x="${CANVAS_W / 2}" y="${lightsY + 4.5}" text-anchor="middle" ` +
    `font-family="${SANS}" font-size="13" fill="${titleFill}">${esc(title)}</text>`;

  // The window card: rounded corners and a hairline border so the chrome reads
  // as a real window against the transparent canvas (no drop shadow — it would
  // be clipped by the tight canvas margins).
  return (
    `<defs>` +
    `<clipPath id="${clipId}"><path d="${contentClipPath()}"/></clipPath>` +
    `</defs>` +
    `<rect x="${MARGIN_X}" y="${MARGIN_TOP}" width="${CARD_W}" height="${CARD_H}" rx="14" ry="14" ` +
    `fill="${barFill}"/>` +
    `<rect x="${MARGIN_X + 0.5}" y="${MARGIN_TOP + 0.5}" width="${CARD_W - 1}" height="${CARD_H - 1}" rx="13.5" ry="13.5" ` +
    `fill="none" stroke="#ffffff" stroke-opacity="0.10"/>` +
    lights +
    titleText +
    `<g clip-path="url(#${clipId})"><g transform="translate(${OX}, ${OY})">${contentSvg}</g></g>` +
    (caption !== undefined && caption !== '' ? lowerThird(caption, id) : '')
  );
}

/**
 * A left-anchored, broadcast-style lower-third pill: an accent bar, a small
 * uppercase brand eyebrow, and the caption. Self-contained (its own filled
 * background) so it stays legible on a transparent canvas over any page color.
 */
function lowerThird(text: string, _id: string): string {
  const bandY = MARGIN_TOP + TITLE_H + CONTENT_H;
  const pillH = 56;
  const pillY = bandY + (CAPTION_H - pillH) / 2;
  const pillX = MARGIN_X;
  // Width grows with the caption (~11.5px/char at 21px) plus padding for the
  // accent bar + eyebrow; clamp so a short caption isn't a stubby pill.
  const textW = Math.round(text.length * 11.5);
  const padL = 30;
  const padR = 30;
  const pillW = Math.max(360, padL + textW + padR);
  const barX = pillX + 16;
  const barW = 5;
  const textX = barX + barW + 16;
  const eyebrowY = pillY + 21;
  const captionY = pillY + 42;

  return (
    `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="13" ry="13" fill="#161b22" fill-opacity="0.96"/>` +
    `<rect x="${pillX + 0.5}" y="${pillY + 0.5}" width="${pillW - 1}" height="${pillH - 1}" rx="12.5" ry="12.5" ` +
    `fill="none" stroke="#ffffff" stroke-opacity="0.10"/>` +
    `<rect x="${barX}" y="${pillY + 14}" width="${barW}" height="${pillH - 28}" rx="2.5" fill="${ACCENT}"/>` +
    `<text x="${textX}" y="${eyebrowY}" font-family="${SANS}" font-size="10.5" font-weight="700" ` +
    `letter-spacing="2" fill="${ACCENT}">GLASSBOX</text>` +
    `<text x="${textX}" y="${captionY}" font-family="${SANS}" font-size="21" font-weight="600" ` +
    `fill="#e8edf4">${esc(text)}</text>`
  );
}
