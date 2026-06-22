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
    // The wrapper's layout size already includes the zoom and it is flex-centered,
    // so the pannable range is symmetric about the center.
    const base = zoomBase(wrap);
    const ww = (base?.w ?? wrap.offsetWidth) * zs.zoom;
    const wh = (base?.h ?? wrap.offsetHeight) * zs.zoom;
    zs.panX = ww <= cw ? 0 : clamp(zs.panX, -(ww - cw) / 2, (ww - cw) / 2);
    zs.panY = wh <= ch ? 0 : clamp(zs.panY, -(wh - ch) / 2, (wh - ch) / 2);
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
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const oldZoom = zs.zoom;
    const newZoom = Math.max(1, Math.min(10, oldZoom * factor));
    // The wrapper is flex-centered, so its left/top shift as it grows. Solve for
    // the new pan that keeps the content point under the cursor fixed.
    const leftOld = (cw - base.w * oldZoom) / 2;
    const topOld = (ch - base.h * oldZoom) / 2;
    const mx = (clientX - contentX - leftOld - zs.panX) / oldZoom;
    const my = (clientY - contentY - topOld - zs.panY) / oldZoom;
    const leftNew = (cw - base.w * newZoom) / 2;
    const topNew = (ch - base.h * newZoom) / 2;
    zs.panX = clientX - contentX - leftNew - mx * newZoom;
    zs.panY = clientY - contentY - topNew - my * newZoom;
    zs.zoom = newZoom;
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
