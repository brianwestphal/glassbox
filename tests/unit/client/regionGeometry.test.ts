import { describe, expect, it } from 'vitest';

import {
  clientToFraction,
  cursorForHandle,
  formatRegionPct,
  hitTestRegion,
  isDrawnRegion,
  MIN_REGION_SIZE,
  moveRegion,
  parseRegion,
  rectFromPoints,
  regionStyle,
  resizeRegion,
} from '../../../src/client/diff/imageDiff/regionGeometry.js';

const RECT = { left: 100, top: 50, width: 200, height: 100 };

describe('clientToFraction', () => {
  it('maps a point to a normalized fraction within the rect', () => {
    expect(clientToFraction(RECT, 200, 100)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('maps the top-left corner to (0,0)', () => {
    expect(clientToFraction(RECT, 100, 50)).toEqual({ x: 0, y: 0 });
  });

  it('clamps points outside the rect to [0,1]', () => {
    expect(clientToFraction(RECT, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(clientToFraction(RECT, 9999, 9999)).toEqual({ x: 1, y: 1 });
  });

  it('returns (0,0) for a degenerate rect', () => {
    expect(clientToFraction({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toEqual({ x: 0, y: 0 });
  });
});

describe('rectFromPoints', () => {
  function expectRegionClose(r: { x: number; y: number; w: number; h: number }, e: { x: number; y: number; w: number; h: number }) {
    expect(r.x).toBeCloseTo(e.x, 8);
    expect(r.y).toBeCloseTo(e.y, 8);
    expect(r.w).toBeCloseTo(e.w, 8);
    expect(r.h).toBeCloseTo(e.h, 8);
  }

  it('builds a region from two corners in natural order', () => {
    expectRegionClose(rectFromPoints({ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.6 }), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });

  it('normalizes when the end point is above/left of the start', () => {
    expectRegionClose(rectFromPoints({ x: 0.4, y: 0.6 }, { x: 0.1, y: 0.2 }), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });
});

describe('isDrawnRegion', () => {
  it('rejects a region below the minimum size (stray click)', () => {
    expect(isDrawnRegion({ x: 0.5, y: 0.5, w: MIN_REGION_SIZE / 2, h: 0.5 })).toBe(false);
  });

  it('accepts a region at or above the minimum size', () => {
    expect(isDrawnRegion({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })).toBe(true);
  });
});

describe('regionStyle', () => {
  it('produces percent CSS positioning', () => {
    expect(regionStyle({ x: 0.25, y: 0.5, w: 0.1, h: 0.2 })).toEqual({
      left: '25%', top: '50%', width: '10%', height: '20%',
    });
  });
});

describe('formatRegionPct', () => {
  it('rounds to whole percentages', () => {
    expect(formatRegionPct({ x: 0.123, y: 0.4, w: 0.305, h: 0.2 })).toBe('12%, 40%, 31%×20%');
  });
});

describe('parseRegion', () => {
  it('parses valid region JSON', () => {
    expect(parseRegion('{"x":0.1,"y":0.2,"w":0.3,"h":0.4}')).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });

  it('parses a region scoped to one side', () => {
    expect(parseRegion('{"x":0.1,"y":0.2,"w":0.3,"h":0.4,"side":"new"}'))
      .toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4, side: 'new' });
  });

  it('rejects an invalid side value', () => {
    expect(parseRegion('{"x":0.1,"y":0.2,"w":0.3,"h":0.4,"side":"both"}')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(parseRegion(null)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseRegion('not json')).toBeNull();
  });

  it('returns null for out-of-range values', () => {
    expect(parseRegion('{"x":2,"y":0,"w":0.1,"h":0.1}')).toBeNull();
  });
});

describe('hitTestRegion', () => {
  // A box at client px (100,100) sized 200×100.
  const BOX = { left: 100, top: 100, width: 200, height: 100 };

  it('returns null well outside the box', () => {
    expect(hitTestRegion(BOX, 10, 10, 8)).toBeNull();
  });

  it('returns move for the interior', () => {
    expect(hitTestRegion(BOX, 200, 150, 8)).toBe('move');
  });

  it('detects each edge', () => {
    expect(hitTestRegion(BOX, 100, 150, 8)).toBe('w');
    expect(hitTestRegion(BOX, 300, 150, 8)).toBe('e');
    expect(hitTestRegion(BOX, 200, 100, 8)).toBe('n');
    expect(hitTestRegion(BOX, 200, 200, 8)).toBe('s');
  });

  it('detects corners', () => {
    expect(hitTestRegion(BOX, 100, 100, 8)).toBe('nw');
    expect(hitTestRegion(BOX, 300, 100, 8)).toBe('ne');
    expect(hitTestRegion(BOX, 100, 200, 8)).toBe('sw');
    expect(hitTestRegion(BOX, 300, 200, 8)).toBe('se');
  });
});

describe('cursorForHandle', () => {
  it('maps handles to resize cursors', () => {
    expect(cursorForHandle('move')).toBe('move');
    expect(cursorForHandle('n')).toBe('ns-resize');
    expect(cursorForHandle('e')).toBe('ew-resize');
    expect(cursorForHandle('ne')).toBe('nesw-resize');
    expect(cursorForHandle('nw')).toBe('nwse-resize');
  });
});

describe('resizeRegion', () => {
  const R = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

  it('moves the dragged edge while keeping the opposite edge fixed', () => {
    const out = resizeRegion(R, 'e', { x: 0.8, y: 0.5 });
    expect(out.x).toBeCloseTo(0.2, 8);
    expect(out.w).toBeCloseTo(0.6, 8);
    expect(out.y).toBeCloseTo(0.2, 8);
    expect(out.h).toBeCloseTo(0.4, 8);
  });

  it('resizes from a corner', () => {
    const out = resizeRegion(R, 'se', { x: 0.9, y: 0.9 });
    expect(out.x).toBeCloseTo(0.2, 8);
    expect(out.y).toBeCloseTo(0.2, 8);
    expect(out.w).toBeCloseTo(0.7, 8);
    expect(out.h).toBeCloseTo(0.7, 8);
  });

  it('never collapses below the minimum size', () => {
    // Drag the west edge past the east edge.
    const out = resizeRegion(R, 'w', { x: 0.99, y: 0.5 });
    expect(out.w).toBeCloseTo(MIN_REGION_SIZE, 8);
  });

  it('preserves the per-side scope', () => {
    const out = resizeRegion({ ...R, side: 'new' }, 'e', { x: 0.8, y: 0.5 });
    expect(out.side).toBe('new');
  });
});

describe('moveRegion', () => {
  const R = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

  it('translates by a delta keeping size', () => {
    const out = moveRegion(R, 0.1, -0.1);
    expect(out).toEqual({ x: expect.closeTo(0.3, 8), y: expect.closeTo(0.1, 8), w: 0.4, h: 0.4 });
  });

  it('clamps so the box stays inside the image', () => {
    const out = moveRegion(R, 1, 1);
    expect(out.x).toBeCloseTo(0.6, 8);
    expect(out.y).toBeCloseTo(0.6, 8);
  });

  it('preserves the per-side scope', () => {
    expect(moveRegion({ ...R, side: 'old' }, 0.1, 0).side).toBe('old');
  });
});
