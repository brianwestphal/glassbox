import { describe, expect, it } from 'vitest';

import { isHighlightableLength, MAX_HIGHLIGHT_LINE_LENGTH } from '../../../src/client/diff/highlightLimits.js';

/**
 * GB-821 — selecting a large minified SVG froze the UI. The diff viewer shows
 * SVGs as a text diff by default, and `applyHighlighting()` ran highlight.js
 * synchronously on the giant single line, emitting tens of thousands of
 * `<span>` elements whose layout locked the main thread. The fix skips
 * highlighting for lines past `MAX_HIGHLIGHT_LINE_LENGTH`. These tests pin the
 * threshold behavior so a regression (e.g. removing the guard, or raising the
 * cap to where the freeze returns) is caught without needing a browser.
 */
describe('GB-821: skip syntax highlighting for very long lines', () => {
  it('highlights normal-length lines', () => {
    expect(isHighlightableLength('')).toBe(true);
    expect(isHighlightableLength('const x = 1;')).toBe(true);
    // A long-but-plausible hand-written/formatted line still highlights.
    expect(isHighlightableLength('x'.repeat(2000))).toBe(true);
  });

  it('skips minified / generated single lines (a 600 KB SVG, a base64 blob)', () => {
    expect(isHighlightableLength('x'.repeat(600_000))).toBe(false);
    expect(isHighlightableLength('x'.repeat(1_086_353))).toBe(false); // real demo.svg size
  });

  it('the cutoff is at the documented threshold, not effectively disabled', () => {
    // The constant must protect against minified blobs while still covering
    // ordinary source lines: comfortably above a long hand-written line, well
    // below a minified single-line file.
    expect(MAX_HIGHLIGHT_LINE_LENGTH).toBeGreaterThan(2000);
    expect(MAX_HIGHLIGHT_LINE_LENGTH).toBeLessThan(100_000);
    expect(isHighlightableLength('x'.repeat(MAX_HIGHLIGHT_LINE_LENGTH))).toBe(true);
    expect(isHighlightableLength('x'.repeat(MAX_HIGHLIGHT_LINE_LENGTH + 1))).toBe(false);
  });
});
