import { parseSvgDimensions, svgUsesExternalFonts } from '../../../src/git/svg-rasterize.js';

describe('parseSvgDimensions', () => {
  it('extracts width and height from attributes', () => {
    const result = parseSvgDimensions('<svg width="200" height="100"></svg>');
    expect(result).toEqual({ width: 200, height: 100 });
  });

  it('extracts dimensions from viewBox when no width/height', () => {
    const result = parseSvgDimensions('<svg viewBox="0 0 500 300"></svg>');
    expect(result).toEqual({ width: 500, height: 300 });
  });

  it('uses viewBox for missing dimension only', () => {
    const result = parseSvgDimensions('<svg width="400" viewBox="0 0 500 300"></svg>');
    expect(result).toEqual({ width: 400, height: 300 });
  });

  it('defaults to 300x150 when no size info', () => {
    const result = parseSvgDimensions('<svg></svg>');
    expect(result).toEqual({ width: 300, height: 150 });
  });

  it('defaults width to 300 when only height is given', () => {
    const result = parseSvgDimensions('<svg height="200"></svg>');
    expect(result).toEqual({ width: 300, height: 200 });
  });

  it('defaults height to 150 when only width is given', () => {
    const result = parseSvgDimensions('<svg width="400"></svg>');
    expect(result).toEqual({ width: 400, height: 150 });
  });

  it('handles viewBox with comma separators', () => {
    const result = parseSvgDimensions('<svg viewBox="0,0,800,600"></svg>');
    expect(result).toEqual({ width: 800, height: 600 });
  });

  it('handles decimal dimensions', () => {
    const result = parseSvgDimensions('<svg width="100.5" height="200.75"></svg>');
    expect(result).toEqual({ width: 100.5, height: 200.75 });
  });

  it('handles dimensions with units (parsed as float)', () => {
    // parseFloat("100px") returns 100
    const result = parseSvgDimensions('<svg width="100px" height="200px"></svg>');
    expect(result).toEqual({ width: 100, height: 200 });
  });
});

describe('svgUsesExternalFonts', () => {
  it('returns true for SVG with text elements', () => {
    const svg = '<svg><text x="10" y="20">Hello</text></svg>';
    expect(svgUsesExternalFonts(Buffer.from(svg))).toBe(true);
  });

  it('returns true for SVG with font-family style', () => {
    const svg = '<svg><rect style="font-family: Arial"/></svg>';
    expect(svgUsesExternalFonts(Buffer.from(svg))).toBe(true);
  });

  it('returns true for SVG with @font-face', () => {
    const svg = '<svg><style>@font-face { font-family: Custom; }</style></svg>';
    expect(svgUsesExternalFonts(Buffer.from(svg))).toBe(true);
  });

  it('returns false for SVG without text or fonts', () => {
    const svg = '<svg><rect width="100" height="100" fill="red"/></svg>';
    expect(svgUsesExternalFonts(Buffer.from(svg))).toBe(false);
  });

  it('is case-insensitive', () => {
    const svg = '<svg><TEXT x="0" y="0">Hi</TEXT></svg>';
    expect(svgUsesExternalFonts(Buffer.from(svg))).toBe(true);
  });
});
