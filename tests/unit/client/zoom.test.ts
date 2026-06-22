import { describe, expect, it } from 'vitest';

import { pickActualSize } from '../../../src/client/diff/imageDiff/zoom.js';

/**
 * GB-951 — "Actual size" (1:1) in side-by-side must size EACH pane to its own
 * image, not just the first. `pickActualSize` is the pure size-selection rule
 * behind the actual-size zoom action; these tests pin the per-pane vs overlay
 * behavior so a regression that goes back to a single shared size is caught.
 */
describe('pickActualSize', () => {
  const base = { w: 300, h: 150 };

  it('uses the pane\'s own image size in side-by-side (the GB-951 fix)', () => {
    // A 64px (old) and a 128px (new) pane each go to their own natural size,
    // even though a server base is present — per-pane wins.
    expect(pickActualSize({ perPane: true, imgNatural: { w: 64, h: 64 }, base }))
      .toEqual({ w: 64, h: 64 });
    expect(pickActualSize({ perPane: true, imgNatural: { w: 128, h: 128 }, base }))
      .toEqual({ w: 128, h: 128 });
  });

  it('prefers the server base for the overlay modes (difference / slice / single)', () => {
    // Not per-pane: the server-provided base (e.g. a rendered SVG\'s parsed
    // intrinsic size) wins over the <img> natural size.
    expect(pickActualSize({ perPane: false, imgNatural: { w: 999, h: 999 }, base }))
      .toEqual({ w: 300, h: 150 });
  });

  it('falls back to the image natural size when there is no base', () => {
    const noBase = { w: 0, h: 0 };
    expect(pickActualSize({ perPane: false, imgNatural: { w: 200, h: 120 }, base: noBase }))
      .toEqual({ w: 200, h: 120 });
  });

  it('falls back to the base when the image size is unavailable (e.g. viewBox-only SVG)', () => {
    expect(pickActualSize({ perPane: true, imgNatural: { w: 0, h: 0 }, base }))
      .toEqual({ w: 300, h: 150 });
  });

  it('returns null when neither a positive image size nor base is available', () => {
    expect(pickActualSize({ perPane: true, imgNatural: { w: 0, h: 0 }, base: { w: 0, h: 0 } }))
      .toBeNull();
  });
});
