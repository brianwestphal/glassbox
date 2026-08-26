/**
 * WCAG AA contrast guards for theme tokens (GB-1184).
 *
 * Line coverage can't catch a theme whose colors quietly fall below AA — these
 * assertions do. Every built-in theme's line-number gutter must stay legible,
 * and the default Light theme's file-status labels (which sit on a 10% tint of
 * their own color) must clear AA. A new theme added below the bar fails here.
 */
import { describe, expect, it } from 'vitest';

import { BUILT_IN_THEMES } from '../../../src/themes/built-in.js';
import { isThemeWcagAA, themeContrastFailures } from '../../../src/themes/contrast.js';

function toRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}
function contrast(fg: string, bg: string): number {
  const a = luminance(toRgb(fg)) + 0.05;
  const b = luminance(toRgb(bg)) + 0.05;
  return Math.max(a, b) / Math.min(a, b);
}
/** Composite an alpha-tinted color over an opaque background (status-label bg). */
function over(fg: string, alpha: number, bg: string): string {
  const f = toRgb(fg), b = toRgb(bg);
  const mix = f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)));
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const AA = 4.5;

describe('theme contrast (WCAG AA)', () => {
  it('every built-in theme keeps line numbers (gutter-text on gutter-bg) at AA', () => {
    for (const theme of BUILT_IN_THEMES) {
      const r = contrast(theme.colors['gutter-text'], theme.colors['gutter-bg']);
      expect(
        r,
        `${theme.name}: gutter-text ${theme.colors['gutter-text']} on ${theme.colors['gutter-bg']} = ${r.toFixed(2)} (needs >= ${AA})`,
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it('default Light theme file-status labels clear AA on their tint', () => {
    const light = BUILT_IN_THEMES.find((t) => t.id === 'light')!;
    for (const key of ['yellow', 'green'] as const) {
      const color = light.colors[key];
      const bg = over(color, 0.1, light.colors.bg);
      const r = contrast(color, bg);
      expect(r, `light .file-status ${key} ${color} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe('WCAG-AA theme set (GB-1185)', () => {
  // The picker's "AA" marker is derived from `isThemeWcagAA`. Pin the exact
  // compliant set so the label can't silently drift: a theme edit that drops a
  // labeled theme below AA — or one that lifts another theme to AA without
  // updating the marketing/marker expectations — fails here and forces a
  // conscious decision. Brand-replica themes (Dracula, Solarized, …) copy their
  // namesake palettes, which aren't AA, and are intentionally NOT in this set.
  const EXPECTED_AA = ['dark', 'light', 'high-contrast-dark', 'high-contrast-light'];

  it('exactly the expected built-in themes report WCAG AA', () => {
    const actual = BUILT_IN_THEMES.filter((t) => isThemeWcagAA(t.colors)).map((t) => t.id).sort();
    expect(actual).toEqual([...EXPECTED_AA].sort());
  });

  it('each AA-flagged theme has zero audited contrast failures', () => {
    for (const id of EXPECTED_AA) {
      const theme = BUILT_IN_THEMES.find((t) => t.id === id)!;
      const fails = themeContrastFailures(theme.colors);
      expect(
        fails,
        `${theme.name} is flagged AA but fails: ${fails.map((f) => `${f.label} ${f.ratio.toFixed(2)}`).join(', ')}`,
      ).toEqual([]);
    }
  });
});
