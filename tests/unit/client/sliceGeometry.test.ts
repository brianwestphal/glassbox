import { describe, expect, it } from 'vitest';

import { cwDist, edgeHandleTransform, edgePos, getEdge, snapToEdge } from '../../../src/client/diff/imageDiff/sliceGeometry.js';

/**
 * GB-823 — the slice tool's bottom handle couldn't be grabbed. Two causes: the
 * canvas overflowed under the toolbar (a CSS layout fix), and a centered
 * `translate(-50%, -50%)` left half of an edge-pinned handle outside the
 * canvas, where `overflow: hidden` clipped it. `edgeHandleTransform` keeps the
 * whole handle inside; these tests pin that (and the surrounding geometry)
 * without a browser.
 */
describe('GB-823: slice handle geometry', () => {
  describe('getEdge', () => {
    it('maps a point to the edge it sits on', () => {
      expect(getEdge(0.5, 0)).toBe('top');
      expect(getEdge(1, 0.5)).toBe('right');
      expect(getEdge(0.5, 1)).toBe('bottom');
      expect(getEdge(0, 0.5)).toBe('left');
    });
  });

  describe('edgeHandleTransform', () => {
    it('nudges the handle fully inside the canvas at every edge', () => {
      // The key invariant: no edge keeps the symmetric -50%/-50% that would
      // straddle (and so clip) the boundary. Top/left pull toward 0; bottom/
      // right pull toward -100%, so the handle box lands inside the canvas.
      expect(edgeHandleTransform('top')).toBe('translate(-50%, 0)');
      expect(edgeHandleTransform('bottom')).toBe('translate(-50%, -100%)');
      expect(edgeHandleTransform('left')).toBe('translate(0, -50%)');
      expect(edgeHandleTransform('right')).toBe('translate(-100%, -50%)');
    });

    it('never uses a vertical -50% on a horizontal edge (the GB-823 clip)', () => {
      // top/bottom handles must not be vertically centered on the edge — that
      // is exactly what put half the handle under the toolbar / outside the
      // clip. The y component is 0 (top) or -100% (bottom).
      expect(edgeHandleTransform('top')).not.toContain('-50%)');
      expect(edgeHandleTransform('bottom')).not.toContain(', -50%)');
    });
  });

  describe('snapToEdge', () => {
    it('clamps out-of-range coordinates to the canvas', () => {
      const p = snapToEdge(1.5, -0.3, 'bottom');
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    });

    it('snaps to the nearest edge', () => {
      // Near the top edge → snaps to y=0.
      expect(snapToEdge(0.5, 0.05, 'bottom')).toEqual({ x: 0.5, y: 0 });
      // Near the right edge → snaps to x=1.
      expect(snapToEdge(0.95, 0.4, 'left')).toEqual({ x: 1, y: 0.4 });
    });

    it('avoids the edge the other handle occupies', () => {
      // A point closest to the bottom edge, but the other handle is on bottom:
      // it must snap to a different edge so the two handles never collapse onto
      // the same edge (which would make a zero-area slice).
      const p = snapToEdge(0.5, 0.9, 'bottom');
      expect(getEdge(p.x, p.y)).not.toBe('bottom');
    });
  });

  describe('clip-path perimeter helpers', () => {
    it('edgePos increases clockwise from the top-left origin', () => {
      expect(edgePos(0, 0)).toBe(0);    // top-left
      expect(edgePos(1, 0)).toBe(1);    // top-right
      expect(edgePos(1, 1)).toBe(2);    // bottom-right
      expect(edgePos(0, 1)).toBe(3);    // bottom-left
    });

    it('cwDist wraps around the perimeter', () => {
      expect(cwDist(0.5, 1.5)).toBeCloseTo(1);
      expect(cwDist(3.5, 0.5)).toBeCloseTo(1); // wraps past 4 → 0
    });
  });
});
