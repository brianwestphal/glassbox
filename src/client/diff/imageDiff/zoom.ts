/**
 * Zoom/pan state for the image-diff canvases. State is stored per-canvas in
 * a WeakMap rather than mutated onto the DOM node, and zoom-change listeners
 * (e.g. the slice tool) register through `onZoomChange` instead of poking a
 * mystery `_onZoomChange` property.
 */

export interface ZoomState {
  zoom: number;
  panX: number;
  panY: number;
}

const zoomStates = new WeakMap<HTMLElement, ZoomState>();
const zoomListeners = new WeakMap<HTMLElement, () => void>();

export function getZoomState(canvas: HTMLElement): ZoomState | undefined {
  return zoomStates.get(canvas);
}

export function setZoomState(canvas: HTMLElement, state: ZoomState): void {
  zoomStates.set(canvas, state);
}

export function onZoomChange(canvas: HTMLElement, listener: () => void): void {
  zoomListeners.set(canvas, listener);
}

export function notifyZoomChange(canvas: HTMLElement): void {
  zoomListeners.get(canvas)?.();
}

/**
 * Whether this wrapper zooms as a vector (an SVG rendered view) rather than a
 * raster bitmap. Vector wrappers grow their *layout* size with zoom — set by
 * `bindImageDiff` via `data-vector-zoom` — so the browser re-rasterizes the SVG
 * crisply at each step instead of magnifying a fixed bitmap (GB-941). Raster
 * images use the cheap `transform: scale()` path, where re-rasterizing would buy
 * nothing.
 */
function isVectorWrap(wrap: HTMLElement): boolean {
  return wrap.dataset.vectorZoom === 'true';
}

/** The wrapper's base (zoom = 1) size in px, as stamped by `sizeWrap` / actual-size. */
function zoomBase(wrap: HTMLElement): { w: number; h: number } | null {
  const w = parseFloat(wrap.dataset.zoomBaseW ?? '');
  const h = parseFloat(wrap.dataset.zoomBaseH ?? '');
  return w > 0 && h > 0 ? { w, h } : null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * The zoom=1 ("actual size") target size for one canvas, in CSS px.
 *
 * - For a side-by-side pane (`perPane`), each pane is 1:1 to its OWN image, so
 *   the image's natural size wins — the old (A) and new (B) panes can be
 *   different sizes and each should be 1:1 to itself (GB-951).
 * - For the overlay modes (difference / slice) and the single-image viewer, the
 *   server-provided base size wins when present — for a rendered SVG that's the
 *   parsed intrinsic size (`parseSvgDimensions`), which is more reliable than an
 *   `<img>`'s `naturalWidth` for a viewBox-only SVG — falling back to the
 *   image's natural size.
 *
 * Returns null when no positive size is available.
 */
export function pickActualSize(opts: {
  perPane: boolean;
  imgNatural: { w: number; h: number };
  base: { w: number; h: number };
}): { w: number; h: number } | null {
  const { perPane, imgNatural, base } = opts;
  const hasBase = base.w > 0 && base.h > 0;
  const hasImg = imgNatural.w > 0 && imgNatural.h > 0;
  if (!perPane && hasBase) return { w: base.w, h: base.h };
  if (hasImg) return { w: imgNatural.w, h: imgNatural.h };
  if (hasBase) return { w: base.w, h: base.h };
  return null;
}

export function applyZoom(wrap: HTMLElement, zs: ZoomState): void {
  if (isVectorWrap(wrap)) {
    // Carry the zoom in the layout size so the SVG re-rasterizes at full
    // resolution; the transform only pans (translate, no scale).
    const base = zoomBase(wrap);
    if (base !== null) {
      wrap.style.width = `${base.w * zs.zoom}px`;
      wrap.style.height = `${base.h * zs.zoom}px`;
    }
    wrap.style.transform = zs.zoom <= 1 ? '' : `translate(${zs.panX}px, ${zs.panY}px)`;
  } else {
    wrap.style.transform = zs.zoom <= 1
      ? ''
      : `translate(${zs.panX}px, ${zs.panY}px) scale(${zs.zoom})`;
  }
  const canvas = wrap.parentElement;
  if (canvas !== null) notifyZoomChange(canvas);
}

export function clampPan(zs: ZoomState, canvas: HTMLElement, wrap: HTMLElement): void {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;

  if (isVectorWrap(wrap)) {
    // The wrapper's layout size already includes the zoom (set by applyZoom).
    // Clamp against its REAL flow position (offsetLeft/offsetTop) rather than
    // assuming the flex parent centers an overflowing child — engines differ on
    // that (some pin the start), and a wrong assumption makes panning feel stuck.
    // Allowed translate keeps the image covering the viewport: the left/top edge
    // can go to 0 and the right/bottom edge down to the canvas edge.
    const ww = wrap.offsetWidth;
    const wh = wrap.offsetHeight;
    const wbx = wrap.offsetLeft;
    const wby = wrap.offsetTop;
    zs.panX = ww <= cw ? 0 : clamp(zs.panX, cw - ww - wbx, -wbx);
    zs.panY = wh <= ch ? 0 : clamp(zs.panY, ch - wh - wby, -wby);
    return;
  }

  const ww = wrap.offsetWidth * zs.zoom;
  const wh = wrap.offsetHeight * zs.zoom;
  if (ww <= cw && wh <= ch) { zs.panX = 0; zs.panY = 0; return; }
  if (ww > cw) {
    const baseLeft = (cw - wrap.offsetWidth) / 2;
    zs.panX = Math.max(cw - baseLeft - ww, Math.min(-baseLeft, zs.panX));
  } else { zs.panX = 0; }
  if (wh > ch) {
    const baseTop = (ch - wrap.offsetHeight) / 2;
    zs.panY = Math.max(ch - baseTop - wh, Math.min(-baseTop, zs.panY));
  } else { zs.panY = 0; }
}

export function zoomAt(
  zs: ZoomState,
  canvas: HTMLElement,
  wrap: HTMLElement,
  clientX: number,
  clientY: number,
  factor: number,
): void {
  const rect = canvas.getBoundingClientRect();
  const contentX = rect.left + canvas.clientLeft;
  const contentY = rect.top + canvas.clientTop;

  if (isVectorWrap(wrap)) {
    const base = zoomBase(wrap);
    if (base === null) return;
    const oldZoom = zs.zoom;
    const newZoom = Math.max(1, Math.min(10, oldZoom * factor));
    // Content fraction under the cursor, measured against the wrapper's real
    // current box (offsetLeft/Width already include the old zoom).
    const wwOld = wrap.offsetWidth;
    const whOld = wrap.offsetHeight;
    const fx = wwOld > 0 ? (clientX - contentX - wrap.offsetLeft - zs.panX) / wwOld : 0.5;
    const fy = whOld > 0 ? (clientY - contentY - wrap.offsetTop - zs.panY) / whOld : 0.5;
    // Apply the new layout size now so offsetLeft/Top reflect where the (re-
    // centered or re-pinned) wrapper actually lands, then solve for the pan that
    // keeps that same content fraction under the cursor.
    zs.zoom = newZoom;
    wrap.style.width = `${base.w * newZoom}px`;
    wrap.style.height = `${base.h * newZoom}px`;
    const wwNew = wrap.offsetWidth;
    const whNew = wrap.offsetHeight;
    zs.panX = clientX - contentX - wrap.offsetLeft - fx * wwNew;
    zs.panY = clientY - contentY - wrap.offsetTop - fy * whNew;
    clampPan(zs, canvas, wrap);
    return;
  }

  const wbx = wrap.offsetLeft;
  const wby = wrap.offsetTop;
  const mx = (clientX - contentX - wbx - zs.panX) / zs.zoom;
  const my = (clientY - contentY - wby - zs.panY) / zs.zoom;

  const oldZoom = zs.zoom;
  const newZoom = Math.max(1, Math.min(10, oldZoom * factor));
  zs.panX += mx * (oldZoom - newZoom);
  zs.panY += my * (oldZoom - newZoom);
  zs.zoom = newZoom;
  clampPan(zs, canvas, wrap);
}
