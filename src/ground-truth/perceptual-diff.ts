import { readFileSync } from 'fs';
import jpeg from 'jpeg-js';
import { extname } from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/**
 * Perceptual image comparison for ground-truth review (doc 26 P2). Decodes the
 * actual + expected images to RGBA and runs a pixelmatch-style per-pixel compare
 * (YIQ color space, anti-aliasing-tolerant threshold) to produce a difference
 * score used to filter identical pairs and triage the review list.
 *
 * Decode is dependency-light pure JS (no native bindings): `pngjs` for PNG,
 * `jpeg-js` for JPEG. Formats we can't decode without rasterizing (SVG/WebP/GIF)
 * return `undecodable` — they're surfaced in the review with no score rather than
 * silently dropped.
 */

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA bytes, length = width * height * 4. */
  data: Uint8Array;
}

export type PerceptualReason = 'ok' | 'undecodable' | 'dimension-mismatch';

export interface PerceptualResult {
  /** Whether a numeric difference score could be computed. */
  scorable: boolean;
  /** Fraction of differing pixels in [0,1]; null when not scorable. */
  score: number | null;
  reason: PerceptualReason;
  /** Differing pixel count + total, when `reason === 'ok'`. */
  diffPixels?: number;
  totalPixels?: number;
}

/**
 * Per-pixel YIQ threshold passed to pixelmatch (0 = exact, 1 = match anything).
 * 0.1 is pixelmatch's own default — it tolerates anti-aliasing and sub-threshold
 * noise so only meaningful changes count toward the score.
 */
export const PERCEPTUAL_THRESHOLD = 0.1;

/** Decode a PNG or JPEG file to RGBA, or null for unreadable / unsupported formats. */
export function decodeImage(path: string): DecodedImage | null {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  const ext = extname(path).toLowerCase();
  try {
    if (ext === '.png') {
      const png = PNG.sync.read(buf);
      return { width: png.width, height: png.height, data: png.data };
    }
    if (ext === '.jpg' || ext === '.jpeg') {
      const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
      return { width: img.width, height: img.height, data: img.data };
    }
  } catch {
    // Corrupt / truncated / unexpected encoding — treat as undecodable.
    return null;
  }
  return null;
}

/**
 * Compare an actual image against an expected image. Returns a difference score
 * (fraction of changed pixels). Differing dimensions can't be pixel-compared, so
 * they score as fully changed; an undecodable side yields no score.
 */
export function comparePerceptual(actualPath: string, expectedPath: string): PerceptualResult {
  const actual = decodeImage(actualPath);
  const expected = decodeImage(expectedPath);
  if (actual === null || expected === null) {
    return { scorable: false, score: null, reason: 'undecodable' };
  }
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return { scorable: true, score: 1, reason: 'dimension-mismatch' };
  }
  const totalPixels = actual.width * actual.height;
  if (totalPixels === 0) {
    return { scorable: true, score: 0, reason: 'ok', diffPixels: 0, totalPixels: 0 };
  }
  const diffPixels = pixelmatch(
    expected.data, actual.data, undefined, actual.width, actual.height,
    { threshold: PERCEPTUAL_THRESHOLD },
  );
  return { scorable: true, score: diffPixels / totalPixels, reason: 'ok', diffPixels, totalPixels };
}

/** A scorable pair with a zero difference score — identical (or anti-aliasing-only). */
export function isIdentical(result: PerceptualResult): boolean {
  return result.scorable && result.score === 0;
}
