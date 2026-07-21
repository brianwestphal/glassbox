import { readFileSync } from 'fs';
import jpeg from 'jpeg-js';
import { extname } from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { decodeImageWithPlugin } from '../plugins/index.js';
import type { DecodedImage } from '../plugins/types.js';

/**
 * Perceptual image comparison for ground-truth review (doc 26 P2). Decodes the
 * actual + expected images to RGBA and runs a pixelmatch-style per-pixel compare
 * (YIQ color space, anti-aliasing-tolerant threshold) to produce a difference
 * score used to filter identical pairs and triage the review list.
 *
 * Core decode is dependency-light pure JS (no native bindings): `pngjs` for PNG,
 * `jpeg-js` for JPEG. Formats core can't decode without rasterizing (SVG/WebP/GIF)
 * fall through to an installed **image-decoder plugin** (doc 29 imageDecoders
 * capability, e.g. WebP/AVIF WASM codecs); only when neither can decode does a
 * pair return `undecodable` — surfaced in the review with no score rather than
 * silently dropped.
 */

/** The RGBA shape the compare consumes — the plugin-contract `DecodedImage`. */
export type { DecodedImage };

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
 * A plugin image decoder: bytes → RGBA, or null when it can't handle them
 * (doc 29 imageDecoders). Defaults to the real dispatch; injectable for tests.
 */
export type PluginImageDecode = (bytes: Uint8Array, path: string, mime?: string) => Promise<DecodedImage | null>;

/**
 * Decode `path` to RGBA: try the core PNG/JPEG decoder first, then fall back to an
 * installed image-decoder plugin (doc 29) for formats core can't handle. Returns
 * null only when neither can decode (unreadable / unsupported everywhere).
 */
async function decodeWithFallback(path: string, pluginDecode: PluginImageDecode): Promise<DecodedImage | null> {
  const core = decodeImage(path);
  if (core !== null) return core;
  let buf: Buffer;
  try { buf = readFileSync(path); } catch { return null; }
  // Defense-in-depth: the plugin decode is untrusted — a throw (or rejection)
  // must never crash launch-time scoring, only yield `undecodable`.
  try { return await pluginDecode(new Uint8Array(buf), path); } catch { return null; }
}

/**
 * Compare an actual image against an expected image. Returns a difference score
 * (fraction of changed pixels). Differing dimensions can't be pixel-compared, so
 * they score as fully changed; a side neither core nor a plugin can decode yields
 * no score. Async because plugin decoders (WASM codecs) may decode asynchronously.
 */
export async function comparePerceptual(
  actualPath: string,
  expectedPath: string,
  pluginDecode: PluginImageDecode = decodeImageWithPlugin,
): Promise<PerceptualResult> {
  const actual = await decodeWithFallback(actualPath, pluginDecode);
  const expected = await decodeWithFallback(expectedPath, pluginDecode);
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
