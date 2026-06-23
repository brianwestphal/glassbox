import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { comparePerceptual, decodeImage, isIdentical } from '../../../src/ground-truth/perceptual-diff.js';

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

  it('scores identical images as 0 and reports them identical', () => {
    const a = writePng('a.png', 10, 10, [120, 130, 140]);
    const b = writePng('b.png', 10, 10, [120, 130, 140]);
    const result = comparePerceptual(a, b);
    expect(result.reason).toBe('ok');
    expect(result.score).toBe(0);
    expect(result.diffPixels).toBe(0);
    expect(isIdentical(result)).toBe(true);
  });

  it('computes the difference score as the fraction of changed pixels', () => {
    // 100 px total, 25 painted a starkly different color.
    const a = writePng('a.png', 10, 10, [0, 0, 0]);
    const b = writePng('b.png', 10, 10, [0, 0, 0], 25, [255, 255, 255]);
    const result = comparePerceptual(a, b);
    expect(result.reason).toBe('ok');
    expect(result.totalPixels).toBe(100);
    expect(result.diffPixels).toBe(25);
    expect(result.score).toBeCloseTo(0.25, 5);
    expect(isIdentical(result)).toBe(false);
  });

  it('treats differing dimensions as fully changed (score 1)', () => {
    const a = writePng('a.png', 10, 10, [0, 0, 0]);
    const b = writePng('b.png', 12, 10, [0, 0, 0]);
    const result = comparePerceptual(a, b);
    expect(result.reason).toBe('dimension-mismatch');
    expect(result.score).toBe(1);
    expect(result.scorable).toBe(true);
  });

  it('returns undecodable (no score) for an unsupported format', () => {
    const svg = join(dir, 'x.svg');
    writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>');
    const png = writePng('a.png', 4, 4, [0, 0, 0]);
    const result = comparePerceptual(png, svg);
    expect(result.reason).toBe('undecodable');
    expect(result.scorable).toBe(false);
    expect(result.score).toBeNull();
    expect(isIdentical(result)).toBe(false);
  });

  it('returns undecodable for a missing file', () => {
    const png = writePng('a.png', 4, 4, [0, 0, 0]);
    expect(comparePerceptual(png, join(dir, 'nope.png')).reason).toBe('undecodable');
  });

  it('returns null from decodeImage for a corrupt image', () => {
    const bad = join(dir, 'bad.png');
    writeFileSync(bad, Buffer.from('not really a png'));
    expect(decodeImage(bad)).toBeNull();
  });
});
