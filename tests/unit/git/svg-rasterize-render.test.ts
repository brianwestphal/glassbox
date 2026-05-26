import { vi } from 'vitest';

const fakePngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const mockRendered = {
  asPng: vi.fn(() => fakePngData),
  free: vi.fn(),
};
const mockResvgInstance = {
  render: vi.fn(() => mockRendered),
  free: vi.fn(),
};

// Use a real function (not arrow) so it's constructable with `new`
const MockResvgClass = vi.fn(function (this: any) {
  Object.assign(this, mockResvgInstance);
});

vi.mock('@resvg/resvg-wasm', () => ({
  initWasm: vi.fn(),
  Resvg: MockResvgClass,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn((path: string, ...args: any[]) => {
      // Allow reading the WASM file path by returning a fake buffer
      if (typeof path === 'string' && path.endsWith('.wasm')) {
        return Buffer.from('fake-wasm');
      }
      return actual.readFileSync(path, ...args);
    }),
    readdirSync: vi.fn(() => []),
  };
});

vi.mock('module', () => ({
  createRequire: () => ({
    resolve: () => '/fake/node_modules/@resvg/resvg-wasm/index.js',
  }),
}));

import { parseSvgDimensions, svgUsesExternalFonts, renderSvgToPng } from '../../../src/git/svg-rasterize-render.js';

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

describe('renderSvgToPng', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the default mock behaviors after clearAllMocks
    mockRendered.asPng.mockReturnValue(fakePngData);
    mockResvgInstance.render.mockReturnValue(mockRendered);
  });

  it('rasterizes a simple SVG to a PNG buffer', async () => {
    const svg = '<svg width="100" height="50"><rect width="100" height="50" fill="red"/></svg>';
    const result = await renderSvgToPng(svg);

    expect(result).toBeInstanceOf(Buffer);
    expect(MockResvgClass).toHaveBeenCalledWith(
      svg,
      expect.objectContaining({
        fitTo: { mode: 'width', value: expect.any(Number) },
        font: expect.objectContaining({
          loadSystemFonts: false,
          defaultFontFamily: 'Helvetica',
        }),
      })
    );
  });

  it('calls render, asPng, and frees resources', async () => {
    const svg = '<svg width="100" height="50"><rect/></svg>';
    await renderSvgToPng(svg);

    expect(mockResvgInstance.render).toHaveBeenCalled();
    expect(mockRendered.asPng).toHaveBeenCalled();
    expect(mockRendered.free).toHaveBeenCalled();
    expect(mockResvgInstance.free).toHaveBeenCalled();
  });

  it('scales up to 10x base size', async () => {
    // 100x50 SVG, scale = min(10, 8000/100) = 10, targetWidth = 1000
    const svg = '<svg width="100" height="50"><rect/></svg>';
    await renderSvgToPng(svg);

    const call = MockResvgClass.mock.calls[0];
    expect(call[1].fitTo.value).toBe(1000); // 100 * 10
  });

  it('caps scale at 8000px max dimension', async () => {
    // 2000x1000 SVG: maxDim=2000, scale=min(10, 8000/2000)=4, targetWidth=2000*4=8000
    const svg = '<svg width="2000" height="1000"><rect/></svg>';
    await renderSvgToPng(svg);

    const call = MockResvgClass.mock.calls[0];
    expect(call[1].fitTo.value).toBe(8000); // 2000 * 4
  });

  it('uses viewBox dimensions when width/height are absent', async () => {
    const svg = '<svg viewBox="0 0 400 200"><rect/></svg>';
    await renderSvgToPng(svg);

    const call = MockResvgClass.mock.calls[0];
    // maxDim=400, scale=min(10,8000/400)=10, targetWidth=400*10=4000
    expect(call[1].fitTo.value).toBe(4000);
  });

  it('defaults to 300x150 for SVG without dimensions', async () => {
    const svg = '<svg><rect/></svg>';
    await renderSvgToPng(svg);

    const call = MockResvgClass.mock.calls[0];
    // default 300x150, maxDim=300, scale=10, targetWidth=3000
    expect(call[1].fitTo.value).toBe(3000);
  });

  it('propagates errors from render', async () => {
    mockResvgInstance.render.mockImplementation(() => {
      throw new Error('Render failed');
    });

    const svg = '<svg width="100" height="100"><rect/></svg>';
    await expect(renderSvgToPng(svg)).rejects.toThrow('Render failed');
  });
});
