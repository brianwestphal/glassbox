/**
 * Pure geometry for the image slice tool. Kept DOM-free (no element refs, no
 * zoom state) so the handle-placement and clip-path math can be unit-tested
 * directly — see `sliceTool.ts` for the imperative wiring that consumes it.
 */

export type Edge = 'top' | 'right' | 'bottom' | 'left';

/** Which canvas edge a normalized point sits on. Handles are always snapped to
 *  an edge (see `snapToEdge`), so one of the first three branches matches; the
 *  `left` fallback covers x === 0. */
export function getEdge(x: number, y: number): Edge {
  if (y === 0) return 'top';
  if (x === 1) return 'right';
  if (y === 1) return 'bottom';
  return 'left';
}

/** Snap a point to the nearest canvas edge, avoiding the edge the *other*
 *  handle already occupies (so the two handles can't collapse onto the same
 *  edge and produce a zero-area slice). Coordinates are clamped to [0,1]. */
export function snapToEdge(x: number, y: number, avoidEdge: Edge): { x: number; y: number } {
  const cx = Math.max(0, Math.min(1, x));
  const cy = Math.max(0, Math.min(1, y));
  const candidates: Array<{ edge: Edge; x: number; y: number; dist: number }> = [
    { edge: 'top',    x: cx, y: 0, dist: cy },
    { edge: 'bottom', x: cx, y: 1, dist: 1 - cy },
    { edge: 'left',   x: 0, y: cy, dist: cx },
    { edge: 'right',  x: 1, y: cy, dist: 1 - cx },
  ];
  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates.find(c => c.edge !== avoidEdge) ?? candidates[0];
  return { x: best.x, y: best.y };
}

/**
 * Transform for a handle pinned to a given edge, keeping the *whole* round
 * handle inside the canvas instead of straddling the edge. A centered
 * `translate(-50%, -50%)` puts half the handle outside the canvas, where
 * `overflow: hidden` clips it (and at the bottom edge, the toolbar covers the
 * sliver that remains) — that's why the bottom handle couldn't be grabbed
 * (GB-823). The slice line still terminates at the true edge; only the handle
 * is nudged inward.
 */
export function edgeHandleTransform(edge: Edge): string {
  switch (edge) {
    case 'top':    return 'translate(-50%, 0)';
    case 'bottom': return 'translate(-50%, -100%)';
    case 'left':   return 'translate(0, -50%)';
    case 'right':  return 'translate(-100%, -50%)';
  }
}

// --- Clip-path edge parameterization ---

/** Map an edge point to a position on a [0,4) clockwise perimeter parameter
 *  (0 = top-left, increasing clockwise). */
export function edgePos(x: number, y: number): number {
  if (y === 0) return x;
  if (x === 1) return 1 + y;
  if (y === 1) return 2 + (1 - x);
  return 3 + (1 - y);
}

/** Clockwise distance from one perimeter parameter to another, wrapping at 4. */
export function cwDist(from: number, to: number): number {
  const d = to - from;
  return d >= 0 ? d : d + 4;
}
