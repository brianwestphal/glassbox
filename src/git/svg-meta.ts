/**
 * Pure SVG metadata helpers — no rendering, no native/WASM dependencies.
 *
 * SVGs are rendered live in the browser (served as `image/svg+xml` from the
 * image route), so Glassbox no longer rasterizes them server-side. These two
 * helpers stay useful for the rendered-view shell: `parseSvgDimensions` seeds
 * the "actual size" zoom target, and `svgUsesExternalFonts` drives the
 * font-rendering caveat banner.
 */

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
