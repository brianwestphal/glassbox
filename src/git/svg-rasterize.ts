import type { Resvg } from '@resvg/resvg-wasm';
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

let initialized = false;
let ResvgClass: typeof Resvg;
let fontBuffers: Uint8Array[] = [];

async function ensureInit() {
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
 * Rasterize an SVG buffer to PNG at 10x base size (max 8000px in largest dimension).
 */
export async function rasterizeSvg(svgData: Buffer): Promise<Buffer> {
  await ensureInit();
  const svgString = svgData.toString('utf-8');
  const { width, height } = parseSvgDimensions(svgString);

  const maxDim = Math.max(width, height);
  const scale = Math.min(10, 8000 / maxDim);
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
