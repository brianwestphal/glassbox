import { describe, expect, it } from 'vitest';

import { parseSvgDimensions, svgUsesExternalFonts } from '../../../src/git/svg-meta.js';

describe('parseSvgDimensions', () => {
  it('reads explicit width/height attributes', () => {
    expect(parseSvgDimensions('<svg width="640" height="480"></svg>')).toEqual({ width: 640, height: 480 });
  });

  it('strips units from width/height (parseFloat)', () => {
    expect(parseSvgDimensions('<svg width="100px" height="50px"></svg>')).toEqual({ width: 100, height: 50 });
  });

  it('falls back to viewBox when width/height are absent', () => {
    expect(parseSvgDimensions('<svg viewBox="0 0 200 120"></svg>')).toEqual({ width: 200, height: 120 });
  });

  it('handles comma-separated viewBox values', () => {
    expect(parseSvgDimensions('<svg viewBox="0,0,300,300"></svg>')).toEqual({ width: 300, height: 300 });
  });

  it('uses width/height where present and viewBox only for the missing dimension', () => {
    expect(parseSvgDimensions('<svg width="80" viewBox="0 0 80 40"></svg>')).toEqual({ width: 80, height: 40 });
  });

  it('defaults to 300x150 per the HTML spec when nothing is specified', () => {
    expect(parseSvgDimensions('<svg></svg>')).toEqual({ width: 300, height: 150 });
  });
});

describe('svgUsesExternalFonts', () => {
  it('detects <text> elements', () => {
    expect(svgUsesExternalFonts(Buffer.from('<svg><text x="0" y="0">hi</text></svg>'))).toBe(true);
  });

  it('detects font-family references', () => {
    expect(svgUsesExternalFonts(Buffer.from('<svg style="font-family: Arial"></svg>'))).toBe(true);
  });

  it('detects @font-face declarations', () => {
    expect(svgUsesExternalFonts(Buffer.from('<svg><style>@font-face { font: x }</style></svg>'))).toBe(true);
  });

  it('returns false for plain shape-only SVGs', () => {
    expect(svgUsesExternalFonts(Buffer.from('<svg><rect width="10" height="10"/></svg>'))).toBe(false);
  });
});
