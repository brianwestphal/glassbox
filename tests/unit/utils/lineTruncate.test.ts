import { describe, expect, it } from 'vitest';

import { MAX_DIFF_LINE_LENGTH, truncateDiffLine } from '../../../src/utils/lineTruncate.js';

/**
 * GB-821 — selecting a large minified SVG froze the UI. The diff viewer shows
 * SVGs as a text diff by default, and rendering the ~1 MB single line put a
 * multi-hundred-KB text node into the DOM whose layout/paint locked the main
 * thread (worst in the desktop app's WKWebView). The fix truncates a line's
 * displayed content past `MAX_DIFF_LINE_LENGTH` so the giant content never
 * reaches the DOM. These tests pin that behavior without needing a browser.
 */
describe('GB-821: truncate pathologically long diff lines for display', () => {
  it('returns null for short / normal-length lines (rendered in full)', () => {
    expect(truncateDiffLine('')).toBeNull();
    expect(truncateDiffLine('const x = 1;')).toBeNull();
    // A long-but-plausible hand-written/formatted line is left intact.
    expect(truncateDiffLine('x'.repeat(2000))).toBeNull();
    expect(truncateDiffLine('x'.repeat(MAX_DIFF_LINE_LENGTH))).toBeNull();
  });

  it('truncates lines past the threshold and reports what was elided', () => {
    const len = 1_086_353; // real demo.svg size
    const result = truncateDiffLine('x'.repeat(len));
    expect(result).not.toBeNull();
    expect(result!.text).toHaveLength(MAX_DIFF_LINE_LENGTH);
    expect(result!.fullLength).toBe(len);
    expect(result!.hidden).toBe(len - MAX_DIFF_LINE_LENGTH);
    // text + hidden must account for the whole original line.
    expect(result!.text.length + result!.hidden).toBe(len);
  });

  it('truncates exactly one character past the threshold', () => {
    const result = truncateDiffLine('x'.repeat(MAX_DIFF_LINE_LENGTH + 1));
    expect(result).not.toBeNull();
    expect(result!.hidden).toBe(1);
    expect(result!.text).toHaveLength(MAX_DIFF_LINE_LENGTH);
  });

  it('keeps the threshold within a sane range', () => {
    // Comfortably above an ordinary source line, but low enough that the
    // rendered prefix is trivial to lay out and paint.
    expect(MAX_DIFF_LINE_LENGTH).toBeGreaterThan(1000);
    expect(MAX_DIFF_LINE_LENGTH).toBeLessThan(50_000);
  });
});
