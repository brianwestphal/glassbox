import type { Resvg } from '@resvg/resvg-wasm';
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

/**
 * Synchronous SVG → PNG render core.
 *
 * `resvg.render()` is CPU-bound WASM work that runs synchronously and can take
 * hundreds of milliseconds (seconds for large/animated SVGs). It therefore runs
 * inside a worker thread in normal operation — see `svg-rasterize.ts`, which
 * offloads to `svg-rasterize-worker.ts`. This module is the shared body used by
 * both the worker and the main-thread fallback; it must not import anything
 * thread-specific so either side can pull it in.
 */

let initialized = false;
let ResvgClass: typeof Resvg;
let fontBuffers: Uint8Array[] = [];

/** Initialize the WASM runtime and load system fonts. Idempotent. */
export async function ensureRenderInit(): Promise<void> {
  if (initialized) return;
  const require = createRequire(import.meta.url);
  const resvgPath = require.resolve('@resvg/resvg-wasm');
  const wasmPath = resvgPath.replace(/index\.(js|mjs)$/, 'index_bg.wasm');
  const wasmBuffer = readFileSync(wasmPath);
  const mod = await import('@resvg/resvg-wasm');
  await mod.initWasm(wasmBuffer);
  ResvgClass = mod.Resvg;
  fontBuffers = loadSystemFonts();
  initialized = true;
}

/**
 * Load a curated set of common system fonts into buffers.
 * The WASM runtime can't access the filesystem directly, so we read
 * specific font files that cover the most common font-family values
 * found in SVGs (serif, sans-serif, monospace, plus popular named fonts).
 * This keeps memory usage to ~20-50 MB instead of loading all fonts (~2 GB).
 */
function loadSystemFonts(): Uint8Array[] {
  const buffers: Uint8Array[] = [];
  const candidates = getFontCandidates();

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      buffers.push(readFileSync(path));
    } catch { /* skip unreadable */ }
  }

  return buffers;
}

function getFontCandidates(): string[] {
  const os = process.platform;

  if (os === 'darwin') {
    const sys = '/System/Library/Fonts';
    const sup = '/System/Library/Fonts/Supplemental';
    return [
      // Core system fonts (serif, sans-serif, monospace)
      join(sys, 'Helvetica.ttc'),
      join(sys, 'Times.ttc'),
      join(sys, 'Courier.ttc'),
      join(sys, 'Menlo.ttc'),
      join(sys, 'SFPro.ttf'),
      join(sys, 'SFNS.ttf'),
      join(sys, 'SFNSMono.ttf'),
      // Supplemental (common named fonts in SVGs)
      join(sup, 'Arial.ttf'),
      join(sup, 'Arial Bold.ttf'),
      join(sup, 'Georgia.ttf'),
      join(sup, 'Verdana.ttf'),
      join(sup, 'Tahoma.ttf'),
      join(sup, 'Trebuchet MS.ttf'),
      join(sup, 'Impact.ttf'),
      join(sup, 'Comic Sans MS.ttf'),
      join(sup, 'Courier New.ttf'),
      join(sup, 'Times New Roman.ttf'),
    ];
  }

  if (os === 'linux') {
    return [
      // DejaVu (most common Linux fallback)
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
      // Liberation (metric-compatible with Arial/Times/Courier)
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
      // Noto (common on modern distros)
      '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    ];
  }

  if (os === 'win32') {
    const winFonts = join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts');
    return [
      join(winFonts, 'arial.ttf'),
      join(winFonts, 'arialbd.ttf'),
      join(winFonts, 'times.ttf'),
      join(winFonts, 'cour.ttf'),
      join(winFonts, 'verdana.ttf'),
      join(winFonts, 'tahoma.ttf'),
      join(winFonts, 'georgia.ttf'),
      join(winFonts, 'consola.ttf'),
      join(winFonts, 'segoeui.ttf'),
    ];
  }

  return [];
}

/** Parse SVG dimensions from width/height/viewBox attributes, following browser defaults. */
export function parseSvgDimensions(svg: string): { width: number; height: number } {
  const widthMatch = svg.match(/\bwidth\s*=\s*["']([^"']+)["']/);
  const heightMatch = svg.match(/\bheight\s*=\s*["']([^"']+)["']/);
  const viewBoxMatch = svg.match(/\bviewBox\s*=\s*["']([^"']+)["']/);

  let width = widthMatch ? parseFloat(widthMatch[1]) : NaN;
  let height = heightMatch ? parseFloat(heightMatch[1]) : NaN;

  if ((isNaN(width) || isNaN(height)) && viewBoxMatch) {
    const parts = viewBoxMatch[1].split(/[\s,]+/);
    if (parts.length >= 4) {
      if (isNaN(width)) width = parseFloat(parts[2]);
      if (isNaN(height)) height = parseFloat(parts[3]);
    }
  }

  if (isNaN(width)) width = 300;
  if (isNaN(height)) height = 150;

  return { width, height };
}

/** Check whether an SVG uses text/fonts that may render differently across machines. */
export function svgUsesExternalFonts(svgData: Buffer): boolean {
  const svg = svgData.toString('utf-8');
  // Has <text> elements or font-family references
  return /<text[\s>]/i.test(svg) || /font-family/i.test(svg) || /@font-face/i.test(svg);
}

/**
 * Maximum dimension of the rasterized PNG, in pixels. The "10x base" scale is
 * intended for crisp zoom-in on small icon-style SVGs; the cap stops large
 * SVGs from being upscaled into multi-tens-of-millions of pixels.
 *
 * GB-838 — the cap used to be `8000` (so a 1280×800 SVG rasterized to
 * 8000×5000 = 40M pixels). `@resvg/resvg-wasm` is happy to attempt that, but
 * a single render of a text-heavy SVG at that size takes 10–28 s on macOS
 * arm64, which exceeds the worker's 15 s per-job timeout. Worse, two
 * concurrent rasterize calls (which happens automatically when the image-
 * comparison panel mounts both `<img>` layers) serialize on the single
 * worker thread, so the second job blows past its timer even when the
 * first succeeds — the user-visible symptom: "old side renders, new side
 * is broken." Capping at 4000 px keeps the comparison canvas crisp at the
 * zoom levels people actually use (~6× before pixelation is visible) and
 * brings a single render down to ~2 s warm, leaving plenty of budget for
 * queued concurrent requests.
 */
export const MAX_RENDER_DIM = 4000;

/**
 * Rasterize an SVG string to PNG at 10x base size (capped at
 * {@link MAX_RENDER_DIM} px in the largest dimension). Synchronous CPU work —
 * call from a worker thread, not the request-handling event loop. Returns a
 * PNG buffer.
 */
export async function renderSvgToPng(svgString: string): Promise<Buffer> {
  await ensureRenderInit();
  const { width, height } = parseSvgDimensions(svgString);

  const maxDim = Math.max(width, height);
  const scale = Math.min(10, MAX_RENDER_DIM / maxDim);
  const targetWidth = Math.round(width * scale);

  const resvg = new ResvgClass(svgString, {
    fitTo: { mode: 'width', value: targetWidth },
    font: {
      loadSystemFonts: false,
      fontBuffers,
      defaultFontFamily: 'Helvetica',
    },
  });

  const rendered = resvg.render();
  const png = Buffer.from(rendered.asPng());
  rendered.free();
  resvg.free();
  return png;
}
