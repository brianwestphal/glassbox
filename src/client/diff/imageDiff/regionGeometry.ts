import { ImageRegionSchema, type ImageRegion } from '../../../api/index.js';

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
