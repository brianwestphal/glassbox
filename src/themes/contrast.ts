/**
 * WCAG contrast helpers + the "does this theme meet AA" check (GB-1185).
 *
 * This is the single source of truth for theme accessibility: the `/themes`
 * list route derives each theme's `wcagAA` flag from here (so the badge in the
 * picker can never claim compliance a theme doesn't have), and the theme test
 * suite asserts the flagged set against the same function.
 *
 * "AA" here means: every text/background pair a reader actually relies on clears
 * WCAG AA (4.5:1 for normal text). The audited pairs are the app's real text
 * surfaces — primary + muted text on the two background levels, links, line
 * numbers, and the four sidebar file-status labels on their tinted pills.
 */
import type { ThemeColors } from './built-in.js';

/** WCAG AA threshold for normal-size text. */
export const AA_TEXT = 4.5;

function toRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6); // ignore alpha for luminance
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG contrast ratio between two opaque colors (order-independent). */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(toRgb(fg)) + 0.05;
  const b = luminance(toRgb(bg)) + 0.05;
  return Math.max(a, b) / Math.min(a, b);
}

/** Composite an RGB color at `alpha` over an opaque hex background → hex. */
function compositeOver(rgb: [number, number, number], alpha: number, bgHex: string): string {
  const bg = toRgb(bgHex);
  const mix = rgb.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The sidebar file-status pills paint a 10% tint of a fixed pastel over the
 *  sidebar background (`--bg-surface`); these pastels mirror `_sidebar.scss`
 *  `.file-status.{added,modified,deleted,renamed}`. The label text is the
 *  theme's own green/yellow/red/purple. */
const STATUS_TINT: Record<'added' | 'modified' | 'deleted' | 'renamed', [[number, number, number], keyof ThemeColors]> = {
  added: [[166, 227, 161], 'green'],
  modified: [[249, 226, 175], 'yellow'],
  deleted: [[243, 139, 168], 'red'],
  renamed: [[203, 166, 247], 'purple'],
};

/** Every audited (label, foreground, background) triple for a theme. */
export function themeContrastPairs(c: ThemeColors): { label: string; ratio: number }[] {
  const pairs: { label: string; fg: string; bg: string }[] = [
    { label: 'text on bg', fg: c.text, bg: c.bg },
    { label: 'text on surface', fg: c.text, bg: c['bg-surface'] },
    { label: 'muted text on bg', fg: c['text-dim'], bg: c.bg },
    { label: 'muted text on surface', fg: c['text-dim'], bg: c['bg-surface'] },
    { label: 'link/accent on bg', fg: c.accent, bg: c.bg },
    { label: 'line numbers', fg: c['gutter-text'], bg: c['gutter-bg'] },
  ];
  for (const [status, [pastel, token]] of Object.entries(STATUS_TINT)) {
    pairs.push({ label: `status: ${status}`, fg: c[token], bg: compositeOver(pastel, 0.1, c['bg-surface']) });
  }
  return pairs.map((p) => ({ label: p.label, ratio: contrastRatio(p.fg, p.bg) }));
}

/** The audited pairs that fall below AA — empty means the theme is AA. */
export function themeContrastFailures(c: ThemeColors): { label: string; ratio: number }[] {
  return themeContrastPairs(c).filter((p) => p.ratio < AA_TEXT);
}

/** True when every audited text pair clears WCAG AA. Defensive: a theme with a
 *  missing or non-hex token (possible for a hand-edited custom theme) is treated
 *  as not-AA rather than throwing, so the `/themes` route can flag any theme. */
export function isThemeWcagAA(c: ThemeColors): boolean {
  try {
    const pairs = themeContrastPairs(c);
    return pairs.length > 0 && pairs.every((p) => Number.isFinite(p.ratio) && p.ratio >= AA_TEXT);
  } catch {
    return false;
  }
}
