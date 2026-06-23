/**
 * Pure zoom/pan geometry for the shared lightbox (GB-963). Kept DOM-free so the
 * math is unit-tested; `lightbox.tsx` does the imperative wiring.
 *
 * The model: an image-sized frame is centered in a fixed viewport and carries a
 * `translate(panX,panY) scale(zoom)` transform (transform-origin: center). Zoom
 * is anchored at the cursor; pan is clamped so a zoomed image can't be dragged
 * fully out of the viewport (and a not-larger-than-viewport image stays centered).
 */

export interface LightboxZoomState {
  zoom: number;
  panX: number;
  panY: number;
}

export const LIGHTBOX_MIN_ZOOM = 1;
export const LIGHTBOX_MAX_ZOOM = 8;

export function clampZoom(z: number): number {
  return Math.max(LIGHTBOX_MIN_ZOOM, Math.min(LIGHTBOX_MAX_ZOOM, z));
}

interface Rect { left: number; top: number; width: number; height: number }

/**
 * Multiply the zoom by `factor`, keeping the content point under the cursor
 * fixed on screen. Pan is *not* clamped here — call `clampPan` afterwards with
 * the resolved content/viewport sizes.
 */
export function zoomTowardCursor(
  state: LightboxZoomState,
  viewport: Rect,
  clientX: number,
  clientY: number,
  factor: number,
): LightboxZoomState {
  const z0 = state.zoom;
  const z1 = clampZoom(z0 * factor);
  if (z1 === z0) return { ...state };
  const cx = viewport.left + viewport.width / 2;
  const cy = viewport.top + viewport.height / 2;
  // Vector from the (panned) frame center to the cursor, in screen px.
  const dx = clientX - cx - state.panX;
  const dy = clientY - cy - state.panY;
  const ratio = z1 / z0;
  return {
    zoom: z1,
    panX: state.panX + dx * (1 - ratio),
    panY: state.panY + dy * (1 - ratio),
  };
}

/**
 * Clamp pan so the scaled content keeps covering the viewport when it's larger,
 * and snaps to centered (pan 0) on an axis where it isn't. `contentW/H` are the
 * frame's base (zoom-1) size; the function applies the zoom itself.
 */
export function clampPan(
  state: LightboxZoomState,
  contentW: number,
  contentH: number,
  viewW: number,
  viewH: number,
): LightboxZoomState {
  const scaledW = contentW * state.zoom;
  const scaledH = contentH * state.zoom;
  const allowedX = Math.max(0, (scaledW - viewW) / 2);
  const allowedY = Math.max(0, (scaledH - viewH) / 2);
  return {
    zoom: state.zoom,
    panX: Math.max(-allowedX, Math.min(allowedX, state.panX)),
    panY: Math.max(-allowedY, Math.min(allowedY, state.panY)),
  };
}

/** The reset / fit state. */
export function resetZoom(): LightboxZoomState {
  return { zoom: 1, panX: 0, panY: 0 };
}
