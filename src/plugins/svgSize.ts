/**
 * Ensure a plugin-rendered SVG has an intrinsic size (doc 29 FR-29.2).
 *
 * Both render paths present plugin SVG through an `<img>` — the review-note
 * artifact thumbnail (a `data:image/svg+xml` inline image) and the file-diff
 * Rendered view (served by the image route). An SVG whose root carries no
 * absolute `width`/`height` (e.g. Mermaid's `width="100%"` + viewBox-only
 * output) has no intrinsic dimensions in an `<img>` context, so it lays out at
 * ~0×0 under the thumbnail CSS and the diagram is invisible. Graphviz and
 * PlantUML emit absolute (`pt`) dimensions and are unaffected.
 *
 * This normalizer runs at the `renderContent` choke point so every plugin —
 * first- or third-party — gets the guarantee: when the root has a `viewBox`
 * but a missing or percentage `width`/`height`, absolute pixel dimensions are
 * injected from the viewBox. SVGs that already carry absolute dimensions (any
 * non-percentage unit) pass through untouched, as does anything unparseable.
 */

/** True when the attribute value provides an intrinsic dimension (any
 *  non-percentage CSS length; a bare number means px). */
function isAbsoluteLength(value: string | undefined): boolean {
  return value !== undefined && /^\s*\d*\.?\d+\s*(px|pt|pc|cm|mm|in|em|rem|ex|ch)?\s*$/i.test(value);
}

function attrValue(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(tag);
  return m?.[1];
}

/** Replace an existing attribute on the root tag, or insert it after `<svg`. */
function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*["'][^"']*["']`);
  if (re.test(tag)) return tag.replace(re, `${name}="${value}"`);
  return tag.replace(/^<svg/, `<svg ${name}="${value}"`);
}

/** Inject absolute `width`/`height` from the viewBox when the SVG root lacks
 *  intrinsic dimensions. Returns the input unchanged when it already has them
 *  (or when there is no viewBox to derive them from). */
export function ensureIntrinsicSvgSize(svg: string): string {
  const start = svg.indexOf('<svg');
  if (start === -1) return svg;
  const end = svg.indexOf('>', start);
  if (end === -1) return svg;
  const tag = svg.slice(start, end + 1);

  const widthOk = isAbsoluteLength(attrValue(tag, 'width'));
  const heightOk = isAbsoluteLength(attrValue(tag, 'height'));
  if (widthOk && heightOk) return svg;

  const viewBox = attrValue(tag, 'viewBox');
  if (viewBox === undefined) return svg;
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length < 4 || !Number.isFinite(parts[2]) || !Number.isFinite(parts[3]) || parts[2] <= 0 || parts[3] <= 0) {
    return svg;
  }

  // Height first, then width: fresh attributes are inserted directly after
  // `<svg`, so the last insertion lands first and the result reads
  // `<svg width=... height=...`.
  let fixed = tag;
  if (!heightOk) fixed = setAttr(fixed, 'height', String(parts[3]));
  if (!widthOk) fixed = setAttr(fixed, 'width', String(parts[2]));
  return svg.slice(0, start) + fixed + svg.slice(end + 1);
}
