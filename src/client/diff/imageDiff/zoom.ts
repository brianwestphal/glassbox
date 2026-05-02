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

export function applyZoom(wrap: HTMLElement, zs: ZoomState): void {
  wrap.style.transform = zs.zoom <= 1
    ? ''
    : `translate(${zs.panX}px, ${zs.panY}px) scale(${zs.zoom})`;
  const canvas = wrap.parentElement;
  if (canvas !== null) notifyZoomChange(canvas);
}

export function clampPan(zs: ZoomState, canvas: HTMLElement, wrap: HTMLElement): void {
  const ww = wrap.offsetWidth * zs.zoom;
  const wh = wrap.offsetHeight * zs.zoom;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
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
  const contentX = canvas.getBoundingClientRect().left + canvas.clientLeft;
  const contentY = canvas.getBoundingClientRect().top + canvas.clientTop;
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
