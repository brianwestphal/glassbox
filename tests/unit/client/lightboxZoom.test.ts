import { describe, expect, it } from 'vitest';

import {
  clampPan,
  clampZoom,
  LIGHTBOX_MAX_ZOOM,
  resetZoom,
  zoomTowardCursor,
} from '../../../src/client/lightboxZoom.js';

// GB-963 — pure zoom/pan geometry for the shared lightbox.
const viewport = { left: 0, top: 0, width: 1000, height: 800 };

describe('clampZoom', () => {
  it('keeps zoom within [1, MAX]', () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(3)).toBe(3);
    expect(clampZoom(999)).toBe(LIGHTBOX_MAX_ZOOM);
  });
});

describe('zoomTowardCursor', () => {
  it('zooming at the viewport center leaves pan at 0', () => {
    const out = zoomTowardCursor(resetZoom(), viewport, 500, 400, 2);
    expect(out.zoom).toBe(2);
    expect(out.panX).toBeCloseTo(0);
    expect(out.panY).toBeCloseTo(0);
  });

  it('keeps the content point under the cursor fixed on screen', () => {
    const start = resetZoom();
    // Cursor at (700, 400): 200px right of center on the X axis.
    const cursorX = 700;
    const cursorY = 400;
    const out = zoomTowardCursor(start, viewport, cursorX, cursorY, 2);
    const cx = viewport.left + viewport.width / 2;
    const cy = viewport.top + viewport.height / 2;
    // The screen position of a content point is center + pan + zoom * local.
    // local for the point initially under the cursor:
    const localX = (cursorX - cx - start.panX) / start.zoom;
    const localY = (cursorY - cy - start.panY) / start.zoom;
    const screenX = cx + out.panX + out.zoom * localX;
    const screenY = cy + out.panY + out.zoom * localY;
    expect(screenX).toBeCloseTo(cursorX);
    expect(screenY).toBeCloseTo(cursorY);
  });

  it('does not change pan when already at max zoom', () => {
    const maxed = { zoom: LIGHTBOX_MAX_ZOOM, panX: 12, panY: -3 };
    const out = zoomTowardCursor(maxed, viewport, 700, 400, 2);
    expect(out).toEqual(maxed);
  });
});

describe('clampPan', () => {
  it('snaps to centered when the content is not larger than the viewport', () => {
    const out = clampPan({ zoom: 1, panX: 50, panY: 50 }, 400, 300, 1000, 800);
    expect(out.panX).toBe(0);
    expect(out.panY).toBe(0);
  });

  it('limits pan so a zoomed image keeps covering the viewport', () => {
    // content 600x400 at zoom 3 → 1800x1200; viewport 1000x800.
    // allowedX = (1800-1000)/2 = 400; allowedY = (1200-800)/2 = 200.
    const out = clampPan({ zoom: 3, panX: 9999, panY: -9999 }, 600, 400, 1000, 800);
    expect(out.panX).toBe(400);
    expect(out.panY).toBe(-200);
  });

  it('leaves an in-range pan untouched', () => {
    const out = clampPan({ zoom: 3, panX: 100, panY: -50 }, 600, 400, 1000, 800);
    expect(out.panX).toBe(100);
    expect(out.panY).toBe(-50);
  });
});
