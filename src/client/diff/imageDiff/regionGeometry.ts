import { type ImageRegion,ImageRegionSchema } from '../../../api/index.js';

/**
 * Pure geometry helpers for image-region feedback (doc 23). Regions are stored
 * in normalized [0,1] fractions of the image so they land in the same spot on
 * both the A and B sides at any zoom/display size. Kept DOM-free so the math is
 * unit-testable.
 */

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Convert a client (viewport) point to a normalized [0,1] fraction within `rect`. */
export function clientToFraction(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

/** Build a normalized region from two corner points (drag start/end), in any order. */
export function rectFromPoints(p0: { x: number; y: number }, p1: { x: number; y: number }): ImageRegion {
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  const w = Math.abs(p1.x - p0.x);
  const h = Math.abs(p1.y - p0.y);
  return { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) };
}

/** A region drawn smaller than this (in either dimension) is treated as a stray click, not a draw. */
export const MIN_REGION_SIZE = 0.01;

/** Whether a region is large enough to keep (filters out accidental click-without-drag). */
export function isDrawnRegion(r: ImageRegion): boolean {
  return r.w >= MIN_REGION_SIZE && r.h >= MIN_REGION_SIZE;
}

/** CSS percent positioning for a region box laid over the image. */
export function regionStyle(r: ImageRegion): { left: string; top: string; width: string; height: string } {
  return {
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
  };
}

/** Human-readable percentage summary, e.g. "12%, 40%, 30%×20%". */
export function formatRegionPct(r: ImageRegion): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `${pct(r.x)}, ${pct(r.y)}, ${pct(r.w)}×${pct(r.h)}`;
}

// --- Move / resize (doc 23 §23.10, GB-936) -------------------------------

/** Which part of a region box a pointer is over. Corner/edge handles resize;
 *  the interior moves the whole box. */
export type RegionHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** How close (in CSS px) the pointer must be to an edge to grab it for resize. */
export const REGION_EDGE_PX = 8;

/**
 * Hit-test a pointer against a region box's on-screen rectangle. Returns the
 * resize handle when near an edge/corner, `'move'` when inside the interior, or
 * `null` when outside the box (plus its edge margin). Pure pixel math so it is
 * unit-testable without a DOM.
 */
export function hitTestRegion(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  edgePx: number = REGION_EDGE_PX,
): RegionHandle | null {
  const { left, top, width, height } = rect;
  const right = left + width;
  const bottom = top + height;
  if (clientX < left - edgePx || clientX > right + edgePx || clientY < top - edgePx || clientY > bottom + edgePx) {
    return null;
  }
  const nearW = Math.abs(clientX - left) <= edgePx;
  const nearE = Math.abs(clientX - right) <= edgePx;
  const nearN = Math.abs(clientY - top) <= edgePx;
  const nearS = Math.abs(clientY - bottom) <= edgePx;
  const v = nearN ? 'n' : nearS ? 's' : '';
  const h = nearW ? 'w' : nearE ? 'e' : '';
  const handle = `${v}${h}`;
  if (handle !== '') return handle as RegionHandle;
  if (clientX >= left && clientX <= right && clientY >= top && clientY <= bottom) return 'move';
  return null;
}

/** The CSS cursor to show while hovering / dragging the given handle. */
export function cursorForHandle(handle: RegionHandle): string {
  switch (handle) {
    case 'move': return 'move';
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'nw': case 'se': return 'nwse-resize';
  }
}

/** Preserve a region's optional per-side scope when rebuilding its geometry. */
function withSide(r: ImageRegion, base: ImageRegion): ImageRegion {
  return r.side !== undefined ? { ...base, side: r.side } : base;
}

/**
 * Resize a region by dragging `handle` to the normalized point `p`. The
 * opposite edge stays fixed and the box is held to {@link MIN_REGION_SIZE} so it
 * never collapses or inverts. Pure; preserves the region's per-side scope.
 */
export function resizeRegion(r: ImageRegion, handle: RegionHandle, p: { x: number; y: number }): ImageRegion {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  const px = clamp01(p.x);
  const py = clamp01(p.y);
  if (handle.includes('w')) left = Math.min(px, right - MIN_REGION_SIZE);
  if (handle.includes('e')) right = Math.max(px, left + MIN_REGION_SIZE);
  if (handle.includes('n')) top = Math.min(py, bottom - MIN_REGION_SIZE);
  if (handle.includes('s')) bottom = Math.max(py, top + MIN_REGION_SIZE);
  return withSide(r, { x: left, y: top, w: right - left, h: bottom - top });
}

/**
 * Translate a region by a normalized delta, clamped so it stays fully inside
 * the image. Pure; preserves size and per-side scope.
 */
export function moveRegion(r: ImageRegion, dx: number, dy: number): ImageRegion {
  const x = Math.max(0, Math.min(1 - r.w, r.x + dx));
  const y = Math.max(0, Math.min(1 - r.h, r.y + dy));
  return withSide(r, { x, y, w: r.w, h: r.h });
}

/** Parse the JSON `region_data` column into a validated region, or null. */
export function parseRegion(regionData: string | null): ImageRegion | null {
  if (regionData === null) return null;
  try {
    const parsed = ImageRegionSchema.safeParse(JSON.parse(regionData) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
