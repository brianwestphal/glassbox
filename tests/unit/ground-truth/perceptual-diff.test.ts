import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { extname, join } from 'path';

import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { comparePerceptual, decodeImage, type DecodedImage, isIdentical, type PluginImageDecode } from '../../../src/ground-truth/perceptual-diff.js';
import { __resetContentPluginsForTest, __setContentRegistryForTest } from '../../../src/plugins/index.js';
import { ContentPluginRegistry } from '../../../src/plugins/registry.js';
import type { ImageDecoder } from '../../../src/plugins/types.js';

// doc 26 P2 — perceptual difference scoring.
describe('perceptual-diff', () => {
  let dir: string;

  // Build a solid-color PNG, optionally overpainting the first `diffPixels`
  // pixels a different color, and write it to disk. Returns the path.
  const writePng = (name: string, w: number, h: number, rgb: [number, number, number], diffPixels = 0, diffRgb: [number, number, number] = [0, 0, 0]): string => {
    const png = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      const c = i < diffPixels ? diffRgb : rgb;
      png.data[o] = c[0];
      png.data[o + 1] = c[1];
      png.data[o + 2] = c[2];
      png.data[o + 3] = 255;
    }
    const p = join(dir, name);
    writeFileSync(p, PNG.sync.write(png));
    return p;
  };

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gt-perc-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('decodes a PNG to RGBA with correct dimensions', () => {
    const img = decodeImage(writePng('a.png', 4, 3, [10, 20, 30]));
    expect(img).not.toBeNull();
    expect(img!.width).toBe(4);
    expect(img!.height).toBe(3);
    expect(img!.data.length).toBe(4 * 3 * 4);
  });

  it('scores identical images as 0 and reports them identical', async () => {
    const a = writePng('a.png', 10, 10, [120, 130, 140]);
    const b = writePng('b.png', 10, 10, [120, 130, 140]);
    const result = await comparePerceptual(a, b);
    expect(result.reason).toBe('ok');
    expect(result.score).toBe(0);
    expect(result.diffPixels).toBe(0);
    expect(isIdentical(result)).toBe(true);
  });

  it('computes the difference score as the fraction of changed pixels', async () => {
    // 100 px total, 25 painted a starkly different color.
    const a = writePng('a.png', 10, 10, [0, 0, 0]);
    const b = writePng('b.png', 10, 10, [0, 0, 0], 25, [255, 255, 255]);
    const result = await comparePerceptual(a, b);
    expect(result.reason).toBe('ok');
    expect(result.totalPixels).toBe(100);
    expect(result.diffPixels).toBe(25);
    expect(result.score).toBeCloseTo(0.25, 5);
    expect(isIdentical(result)).toBe(false);
  });

  it('treats differing dimensions as fully changed (score 1)', async () => {
    const a = writePng('a.png', 10, 10, [0, 0, 0]);
    const b = writePng('b.png', 12, 10, [0, 0, 0]);
    const result = await comparePerceptual(a, b);
    expect(result.reason).toBe('dimension-mismatch');
    expect(result.score).toBe(1);
    expect(result.scorable).toBe(true);
  });

  it('returns undecodable (no score) for an unsupported format', async () => {
    const svg = join(dir, 'x.svg');
    writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>');
    const png = writePng('a.png', 4, 4, [0, 0, 0]);
    const result = await comparePerceptual(png, svg);
    expect(result.reason).toBe('undecodable');
    expect(result.scorable).toBe(false);
    expect(result.score).toBeNull();
    expect(isIdentical(result)).toBe(false);
  });

  it('returns undecodable for a missing file', async () => {
    const png = writePng('a.png', 4, 4, [0, 0, 0]);
    expect((await comparePerceptual(png, join(dir, 'nope.png'))).reason).toBe('undecodable');
  });

  it('returns null from decodeImage for a corrupt image', () => {
    const bad = join(dir, 'bad.png');
    writeFileSync(bad, Buffer.from('not really a png'));
    expect(decodeImage(bad)).toBeNull();
  });

  // doc 29 imageDecoders capability (GB-1063): a format core can't decode becomes
  // scorable when an installed plugin decoder handles it.
  describe('plugin image-decoder fallback', () => {
    // A fake plugin decoder that "decodes" a .fake file to a solid-color RGBA of
    // a fixed size, so a pair of them is pixel-comparable.
    const fakeDecode = (rgb: [number, number, number], w = 4, h = 4): (b: Uint8Array, p: string) => Promise<DecodedImage | null> =>
      async (_b, p) => {
        if (extname(p) !== '.fake') return null;
        const data = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255;
        }
        return { width: w, height: h, data };
      };

    it('scores an otherwise-undecodable pair via the plugin decoder', async () => {
      const a = join(dir, 'a.fake'); writeFileSync(a, Buffer.from('opaque-a'));
      const b = join(dir, 'b.fake'); writeFileSync(b, Buffer.from('opaque-b'));
      const result = await comparePerceptual(a, b, fakeDecode([10, 20, 30]));
      expect(result.reason).toBe('ok');
      expect(result.scorable).toBe(true);
      expect(result.score).toBe(0); // both decode to the same solid color
      expect(result.totalPixels).toBe(16);
    });

    it('prefers the core decoder over the plugin (core wins for PNG)', async () => {
      const a = writePng('a.png', 6, 6, [0, 0, 0]);
      const b = writePng('b.png', 6, 6, [0, 0, 0]);
      // A plugin decoder that would return a differently-sized image is never
      // consulted because core decodes PNG.
      const result = await comparePerceptual(a, b, fakeDecode([255, 0, 0], 2, 2));
      expect(result.reason).toBe('ok');
      expect(result.totalPixels).toBe(36);
      expect(result.score).toBe(0);
    });

    it('stays undecodable (no crash) when the plugin decoder throws', async () => {
      const a = join(dir, 'a.fake'); writeFileSync(a, Buffer.from('x'));
      const b = join(dir, 'b.fake'); writeFileSync(b, Buffer.from('y'));
      const throwing: PluginImageDecode = () => { throw new Error('boom'); };
      const result = await comparePerceptual(a, b, throwing);
      expect(result.reason).toBe('undecodable');
      expect(result.score).toBeNull();
    });

    it('stays undecodable when the plugin decoder returns null (no match)', async () => {
      const a = join(dir, 'a.fake'); writeFileSync(a, Buffer.from('x'));
      const b = join(dir, 'b.fake'); writeFileSync(b, Buffer.from('y'));
      const result = await comparePerceptual(a, b, async () => null);
      expect(result.reason).toBe('undecodable');
      expect(result.scorable).toBe(false);
    });
  });

  // The production seam: comparePerceptual with its DEFAULT decoder
  // (`decodeImageWithPlugin`) hitting a real installed registry — the exact path
  // the ground-truth launch flow runs after initContentPlugins.
  describe('default decoder over a real registry (production seam)', () => {
    afterEach(() => __resetContentPluginsForTest());

    // A decoder that turns a .fake file's byte length into a 1x(len) solid image,
    // so two different-length files score as fully changed and same-length as 0.
    const fakeDecoder: ImageDecoder = {
      name: 'fake', match: { extensions: ['.fake'] },
      decode: ({ bytes }) => {
        const h = Math.max(1, bytes.length);
        const data = new Uint8Array(1 * h * 4);
        for (let i = 0; i < h; i++) { data[i * 4] = bytes[0] ?? 0; data[i * 4 + 3] = 255; }
        return { width: 1, height: h, data };
      },
    };

    it('scores an otherwise-undecodable pair via the installed decoder (no injection)', async () => {
      const reg = new ContentPluginRegistry();
      reg.addImageDecoders([fakeDecoder]);
      __setContentRegistryForTest(reg);
      const a = join(dir, 'a.fake'); writeFileSync(a, Buffer.from([7, 7, 7, 7]));
      const b = join(dir, 'b.fake'); writeFileSync(b, Buffer.from([7, 7, 7, 7]));
      const result = await comparePerceptual(a, b); // default decoder
      expect(result.reason).toBe('ok');
      expect(result.score).toBe(0);
      expect(result.totalPixels).toBe(4);
    });

    it('is undecodable when no decoder is installed (default fallthrough)', async () => {
      __setContentRegistryForTest(new ContentPluginRegistry());
      const a = join(dir, 'a.fake'); writeFileSync(a, Buffer.from('x'));
      const b = join(dir, 'b.fake'); writeFileSync(b, Buffer.from('y'));
      expect((await comparePerceptual(a, b)).reason).toBe('undecodable');
    });
  });
});
