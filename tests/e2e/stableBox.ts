import { expect, type Locator } from '@playwright/test';

/**
 * Wait until a locator's bounding box stops changing (its layout has settled),
 * then return the stable box.
 *
 * Reading a `boundingBox()` mid-reflow — e.g. right after an image's intrinsic
 * dimensions are known but before its container finishes fitting/centering it —
 * yields a transient position. Coordinate-based drags then land in the wrong spot,
 * and "did it move?" assertions catch the layout shift as a phantom move. Both were
 * sources of e2e flake (GB-1031: the difference-view pan test's ~39px phantom pan at
 * fit, and the note-artifact region-draw whose first drag missed and never opened the
 * reply form). Polling until two consecutive reads match removes that window.
 */
export async function waitForStableBox(locator: Locator, tolerance = 0.5) {
  let prev: Awaited<ReturnType<Locator['boundingBox']>> = null;
  await expect
    .poll(
      async () => {
        const cur = await locator.boundingBox();
        const same =
          prev !== null && cur !== null &&
          Math.abs(cur.x - prev.x) <= tolerance &&
          Math.abs(cur.y - prev.y) <= tolerance &&
          Math.abs(cur.width - prev.width) <= tolerance &&
          Math.abs(cur.height - prev.height) <= tolerance;
        prev = cur;
        return same;
      },
      { timeout: 5000, intervals: [80, 80, 80, 80, 80, 80] },
    )
    .toBe(true);
  if (prev === null) throw new Error('element never produced a bounding box');
  return prev;
}
