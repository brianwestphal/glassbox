import { describe, expect, it } from 'vitest';

import {
  clientToFraction,
  formatRegionPct,
  isDrawnRegion,
  MIN_REGION_SIZE,
  parseRegion,
  rectFromPoints,
  regionStyle,
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
