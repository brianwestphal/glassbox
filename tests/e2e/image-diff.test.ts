import { test, expect } from './coverage-fixture.js';

/**
 * GB-823 — the bottom handle of the image *slice* comparison couldn't be
 * grabbed. The canvas used a hardcoded `height: calc(100vh - 80px)` that
 * overshot its real slot, so its bottom edge — where the bottom handle is
 * pinned — extended under the bottom toolbar, which then intercepted the
 * clicks. (A centered handle transform also left half the handle outside the
 * canvas's `overflow: hidden`.)
 *
 * Unlike the GB-821 paint freeze, this is a layout / hit-testing bug, which a
 * headless browser computes faithfully — so `elementFromPoint` over the handle
 * is a reliable, deterministic guard here.
 *
 * Demo scenario 4 includes an image diff (`src-tauri/icons/128x128.png`,
 * modeled as a rename so old/new resolve to two real images), which is what
 * makes this end-to-end coverage of the image comparison modes possible.
 */

const IMAGE_FILE = '128x128.png';

async function openImageDiff(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
  await page.locator('.file-item .file-name', { hasText: IMAGE_FILE }).click();
  await expect(page.locator('.image-diff')).toBeVisible({ timeout: 5000 });
}

test.describe('Image diff slice tool (GB-823)', () => {
  test('renders an image comparison with both sides', async ({ page }) => {
    await openImageDiff(page);
    const imageDiff = page.locator('.image-diff');
    await expect(imageDiff).toHaveAttribute('data-has-old', 'true');
    await expect(imageDiff).toHaveAttribute('data-has-new', 'true');
    // A two-sided image diff offers the difference + slice comparison modes.
    await expect(page.locator('[data-image-mode="slice"]')).toBeVisible();
    await expect(page.locator('[data-image-mode="difference"]')).toBeVisible();
  });

  test('both slice handles are grabbable — the bottom one is not hidden under the toolbar', async ({ page }) => {
    await openImageDiff(page);
    await page.locator('[data-image-mode="slice"]').click();
    await expect(page.locator('.slice-handle-b')).toBeVisible();

    const probe = await page.evaluate(() => {
      const canvas = document.querySelector('[data-panel="slice"] .image-visual-canvas');
      const toolbar = document.getElementById('diff-toolbar');
      const a = document.querySelector('.slice-handle-a');
      const b = document.querySelector('.slice-handle-b');
      if (!canvas || !toolbar || !a || !b) return { ok: false } as const;
      const cr = canvas.getBoundingClientRect();
      const tr = toolbar.getBoundingClientRect();
      const hit = (el: Element) => {
        const r = el.getBoundingClientRect();
        const e = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        // The handle, or (defensively) a descendant of it, must be on top.
        return e === el || (e !== null && el.contains(e)) || (e !== null && e.classList.contains('slice-handle'));
      };
      const within = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.top >= cr.top - 0.5 && r.bottom <= cr.bottom + 0.5;
      };
      return {
        ok: true,
        canvasOverlapsToolbar: cr.bottom > tr.top + 0.5,
        handleAInside: within(a),
        handleBInside: within(b),
        handleAGrabbable: hit(a),
        handleBGrabbable: hit(b),
      } as const;
    });

    expect(probe.ok).toBe(true);
    if (!probe.ok) return;
    // The core regression: the canvas must not extend under the toolbar...
    expect(probe.canvasOverlapsToolbar, 'canvas must not overlap the toolbar').toBe(false);
    // ...both handles must sit inside the (overflow-clipped) canvas...
    expect(probe.handleAInside, 'top handle inside canvas').toBe(true);
    expect(probe.handleBInside, 'bottom handle inside canvas').toBe(true);
    // ...and crucially, the bottom handle must receive the click (the bug:
    // the toolbar was on top of it).
    expect(probe.handleAGrabbable, 'top handle grabbable').toBe(true);
    expect(probe.handleBGrabbable, 'bottom handle grabbable').toBe(true);
  });

  test('the bottom slice handle can be dragged to a new position', async ({ page }) => {
    await openImageDiff(page);
    await page.locator('[data-image-mode="slice"]').click();
    const handle = page.locator('.slice-handle-b');
    await expect(handle).toBeVisible();

    const before = await handle.boundingBox();
    const canvas = await page.locator('[data-panel="slice"] .image-visual-canvas').boundingBox();
    if (!before || !canvas) throw new Error('missing geometry');

    // Drag the bottom handle toward the left edge of the canvas.
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 8, canvas.y + canvas.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = await handle.boundingBox();
    if (!after) throw new Error('handle vanished after drag');
    const moved = Math.abs(after.x - before.x) > 20 || Math.abs(after.y - before.y) > 20;
    expect(moved, 'bottom handle should move when dragged').toBe(true);
  });
});

// Doc 23 — image feedback: general comments + drawn rectangle regions.
test.describe('Image feedback (doc 23)', () => {
  async function showDifference(page: import('@playwright/test').Page) {
    await page.locator('[data-image-mode="difference"]').click();
    // Wait for the image layer to decode so the region overlay has real size.
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('[data-panel="difference"] .image-layer-old');
      return img !== null && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 10000 });
  }

  test('adds a general image comment that persists across reload', async ({ page }) => {
    await openImageDiff(page);
    const panel = page.locator('[data-image-feedback]');
    await expect(panel.locator('[data-role="general-input"]')).toBeVisible({ timeout: 5000 });

    await panel.locator('[data-role="general-input"]').fill('The exported icon looks washed out');
    await panel.locator('[data-action="add-general"]').click();

    const item = panel.locator('[data-list="general"] .image-feedback-item');
    await expect(item).toContainText('The exported icon looks washed out', { timeout: 5000 });

    // Reload and reopen — the comment is loaded from the database.
    await openImageDiff(page);
    await expect(page.locator('[data-image-feedback] [data-list="general"] .image-feedback-item'))
      .toContainText('The exported icon looks washed out', { timeout: 5000 });
  });

  test('draws a rectangle region, comments on it, and shows it on the image', async ({ page }) => {
    await openImageDiff(page);
    await showDifference(page);

    // Enter draw mode, then drag a rectangle across the region overlay.
    await page.locator('[data-action="toggle-draw"]').click();
    const overlay = page.locator('[data-panel="difference"] [data-region-overlay]');
    const box = await overlay.boundingBox();
    if (!box) throw new Error('region overlay has no box');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65, { steps: 8 });
    await page.mouse.up();

    // The pending region awaits its comment.
    const pendingInput = page.locator('[data-role="pending-input"]');
    await expect(pendingInput).toBeVisible({ timeout: 5000 });
    await pendingInput.fill('This corner is misaligned');
    await page.locator('[data-action="save-pending"]').click();

    // The region box renders on the image overlay and appears in the region list.
    await expect(page.locator('[data-panel="difference"] .region-box')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-list="regions"] .image-feedback-item'))
      .toContainText('This corner is misaligned');

    // Persists across reload.
    await openImageDiff(page);
    await showDifference(page);
    await expect(page.locator('[data-panel="difference"] .region-box')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-list="regions"] .image-feedback-item'))
      .toContainText('This corner is misaligned');
  });
});

// Doc 23 §23.6 / §23.10 — image-feedback follow-ups (GB-936..GB-940).
test.describe('Image feedback follow-ups', () => {
  async function showDifference(page: import('@playwright/test').Page) {
    await page.locator('[data-image-mode="difference"]').click();
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('[data-panel="difference"] .image-layer-old');
      return img !== null && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 10000 });
  }

  // The demo review persists annotations across tests, so each test scopes its
  // assertions to the specific region it creates (identified by annotation id),
  // not `.first()`, which could resolve to a region left over from an earlier test.
  interface DrawnRegion {
    id: string;
    row: import('@playwright/test').Locator;
    box: import('@playwright/test').Locator;
  }

  /** Enter draw mode and drag a rectangle (in overlay fractions) across the
   *  difference overlay, add `comment`, and return locators scoped to the new
   *  region by its annotation id. */
  async function drawRegion(
    page: import('@playwright/test').Page,
    comment: string,
    f0: { x: number; y: number } = { x: 0.3, y: 0.3 },
    f1: { x: number; y: number } = { x: 0.6, y: 0.6 },
  ): Promise<DrawnRegion> {
    await page.locator('[data-action="toggle-draw"]').click();
    const overlay = page.locator('[data-panel="difference"] [data-region-overlay]');
    const box = await overlay.boundingBox();
    if (!box) throw new Error('region overlay has no box');
    await page.mouse.move(box.x + box.width * f0.x, box.y + box.height * f0.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * f1.x, box.y + box.height * f1.y, { steps: 8 });
    await page.mouse.up();
    const pendingInput = page.locator('[data-role="pending-input"]');
    await expect(pendingInput).toBeVisible({ timeout: 5000 });
    await pendingInput.fill(comment);
    await page.locator('[data-action="save-pending"]').click();

    const row = page.locator('[data-list="regions"] .image-feedback-item', { hasText: comment });
    await expect(row).toBeVisible({ timeout: 5000 });
    const id = await row.getAttribute('data-id');
    if (id === null || id === 'pending') throw new Error(`region row has no saved id (${id})`);
    const regionBox = page.locator(`[data-panel="difference"] .region-box[data-region-id="${id}"]`);
    await expect(regionBox).toBeVisible({ timeout: 5000 });
    return { id, row, box: regionBox };
  }

  // GB-938: pick a category for image feedback (not always `note`).
  test('a general comment can be given a non-default category that persists', async ({ page }) => {
    await openImageDiff(page);
    const panel = page.locator('[data-image-feedback]');
    await expect(panel.locator('[data-role="general-input"]')).toBeVisible({ timeout: 5000 });

    // Composer badge defaults to Note; open the picker and choose Bug.
    await panel.locator('[data-action="pick-general-cat"]').click();
    await page.locator('.reclassify-popup .reclassify-option[data-value="bug"]').click();
    const text = 'Wrong corner radius';
    await panel.locator('[data-role="general-input"]').fill(text);
    await panel.locator('[data-action="add-general"]').click();

    const item = panel.locator('[data-list="general"] .image-feedback-item', { hasText: text });
    await expect(item.locator('[data-action="pick-category"]')).toHaveAttribute('data-category', 'bug', { timeout: 5000 });

    await openImageDiff(page);
    await expect(page.locator('[data-image-feedback] [data-list="general"] .image-feedback-item', { hasText: text })
      .locator('[data-action="pick-category"]'))
      .toHaveAttribute('data-category', 'bug', { timeout: 5000 });
  });

  // GB-937: hovering a region list row highlights its box on the image.
  test('hovering a region row highlights its box (and vice versa)', async ({ page }) => {
    await openImageDiff(page);
    await showDifference(page);
    const region = await drawRegion(page, 'Halo around the glyph');

    await region.row.hover();
    await expect(region.box).toHaveClass(/region-box-active/, { timeout: 5000 });
    // Moving away from the row clears the highlight.
    await page.locator('.image-feedback-heading').first().hover();
    await expect(region.box).not.toHaveClass(/region-box-active/, { timeout: 5000 });
  });

  // GB-939: scope a region to one side (A-only / B-only).
  test('a region can be scoped to one side and persists', async ({ page }) => {
    await openImageDiff(page);
    await showDifference(page);
    const region = await drawRegion(page, 'Artifact only in the new image');

    const sideBadge = region.row.locator('[data-action="cycle-side"]');
    await expect(sideBadge).toHaveText('A+B');
    // Cycle both -> A -> B.
    await sideBadge.click();
    await expect(sideBadge).toHaveText('A');
    await sideBadge.click();
    await expect(sideBadge).toHaveText('B');
    await expect(region.box).toHaveClass(/region-box-b/);

    await openImageDiff(page);
    await showDifference(page);
    await expect(page.locator('[data-list="regions"] .image-feedback-item', { hasText: 'Artifact only in the new image' })
      .locator('[data-action="cycle-side"]'))
      .toHaveText('B', { timeout: 5000 });
  });

  // GB-936: an existing region can be dragged to a new position; it persists.
  test('a region box can be moved and the new position persists', async ({ page }) => {
    await openImageDiff(page);
    await showDifference(page);
    const region = await drawRegion(page, 'Misplaced badge', { x: 0.25, y: 0.25 }, { x: 0.45, y: 0.45 });

    const before = await region.box.boundingBox();
    if (!before) throw new Error('region box has no box');

    // Grab the interior (center) and drag right + down.
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 40, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => {
      const b = await region.box.boundingBox();
      return b ? Math.round(b.x - before.x) : 0;
    }, { timeout: 5000 }).toBeGreaterThan(30);

    const moved = await region.box.boundingBox();
    if (!moved) throw new Error('region box vanished after move');

    // Reload: the moved position is restored from the database.
    await openImageDiff(page);
    await showDifference(page);
    const reloadedBox = page.locator(`[data-panel="difference"] .region-box[data-region-id="${region.id}"]`);
    const reloaded = await reloadedBox.boundingBox();
    if (!reloaded) throw new Error('region box missing after reload');
    expect(Math.abs(reloaded.x - moved.x)).toBeLessThan(8);
    expect(Math.abs(reloaded.y - moved.y)).toBeLessThan(8);
  });

  // GB-940: drawing while zoomed/panned stores coords that match the on-screen
  // rectangle, because clientToFraction uses the overlay's live (transformed) rect.
  test('drawing while zoomed and panned lands the box where it was drawn', async ({ page }) => {
    await openImageDiff(page);
    await showDifference(page);

    // Zoom in (>1) so panning is enabled, then pan the canvas.
    const zoomIn = page.locator('.diff-toolbar-image [data-zoom-action="in"]');
    await zoomIn.click();
    await zoomIn.click();
    const canvas = page.locator('[data-panel="difference"] .image-visual-canvas');
    const cbox = await canvas.boundingBox();
    if (!cbox) throw new Error('canvas has no box');
    await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cbox.x + cbox.width / 2 + 30, cbox.y + cbox.height / 2 + 20, { steps: 6 });
    await page.mouse.up();

    // Draw a rectangle at known screen coordinates near the canvas center.
    await page.locator('[data-action="toggle-draw"]').click();
    const cx = cbox.x + cbox.width / 2;
    const cy = cbox.y + cbox.height / 2;
    const x0 = cx - 40, y0 = cy - 30, x1 = cx + 40, y1 = cy + 30;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 10 });
    await page.mouse.up();
    const comment = 'Drawn while zoomed';
    await page.locator('[data-role="pending-input"]').fill(comment);
    await page.locator('[data-action="save-pending"]').click();

    // Scope to the region we just drew (not a leftover from an earlier test).
    const row = page.locator('[data-list="regions"] .image-feedback-item', { hasText: comment });
    await expect(row).toBeVisible({ timeout: 5000 });
    const id = await row.getAttribute('data-id');
    const regionBox = page.locator(`[data-panel="difference"] .region-box[data-region-id="${id}"]`);
    await expect(regionBox).toBeVisible({ timeout: 5000 });
    const drawn = await regionBox.boundingBox();
    if (!drawn) throw new Error('drawn region box has no box');

    // The rendered box must match the screen rectangle we dragged (a few px
    // tolerance for border width / rounding). This is the core GB-940 assertion:
    // no drift between the drawn rectangle and the stored/rendered region.
    expect(Math.abs(drawn.x - x0)).toBeLessThan(6);
    expect(Math.abs(drawn.y - y0)).toBeLessThan(6);
    expect(Math.abs(drawn.width - (x1 - x0))).toBeLessThan(6);
    expect(Math.abs(drawn.height - (y1 - y0))).toBeLessThan(6);
  });
});

// GB-941 — SVG rendered view zooms as a vector (re-rasterizes) instead of
// magnifying a fixed bitmap. The deterministic proxy: a vector wrap grows its
// *layout* size (offsetWidth) with zoom, so the browser re-renders the SVG at
// full resolution; a raster wrap keeps a constant layout size and only the CSS
// transform scales it (which is what produced the pixelation).
test.describe('SVG vector zoom (GB-941)', () => {
  const SVG_FILE = 'icon.svg';

  async function openRenderedSvg(page: import('@playwright/test').Page) {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-item .file-name', { hasText: SVG_FILE }).click();
    // The SVG view toggle appears for SVG files; switch to the rendered view.
    await expect(page.locator('[data-svg-mode="rendered"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-svg-mode="rendered"]').click();
    await expect(page.locator('.diff-view[data-is-svg="true"] .image-diff')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-image-mode="difference"]').click();
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('[data-panel="difference"] .image-layer-old');
      return img !== null && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 10000 });
  }

  function wrapLayoutWidth(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>('[data-panel="difference"] .image-zoom-wrap');
      return wrap ? wrap.offsetWidth : 0;
    });
  }

  function canvasWidth(page: import('@playwright/test').Page): Promise<number> {
    return page.evaluate(() => {
      const c = document.querySelector<HTMLElement>('[data-panel="difference"] .image-visual-canvas');
      return c ? c.clientWidth : 0;
    });
  }

  test('the wrapper is flagged for vector zoom', async ({ page }) => {
    await openRenderedSvg(page);
    await expect(page.locator('[data-panel="difference"] .image-zoom-wrap'))
      .toHaveAttribute('data-vector-zoom', 'true');
  });

  test('zooming in grows the layout size (re-raster) without a transform scale', async ({ page }) => {
    await openRenderedSvg(page);
    const base = await wrapLayoutWidth(page);
    expect(base).toBeGreaterThan(0);

    const zoomIn = page.locator('.diff-toolbar-image [data-zoom-action="in"]');
    await zoomIn.click();
    await zoomIn.click();

    // Layout width grew — the SVG is re-rasterized at the larger size.
    await expect.poll(() => wrapLayoutWidth(page), { timeout: 5000 }).toBeGreaterThan(base + 10);

    // And the wrapper is positioned by translate only — no scale() that would
    // magnify a bitmap.
    const transform = await page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>('[data-panel="difference"] .image-zoom-wrap');
      return wrap ? wrap.style.transform : '';
    });
    expect(transform).not.toContain('scale(');

    // Fit resets back to the base layout size.
    await page.locator('.diff-toolbar-image [data-zoom-action="fit"]').click();
    await expect.poll(() => wrapLayoutWidth(page), { timeout: 5000 }).toBeLessThan(base + 2);
  });

  // Regression for the flex-shrink clamp: a vector wrap must be allowed to grow
  // PAST the canvas. The flex parent's default flex-shrink:1 would otherwise pull
  // the wrapper back to the canvas size, so the SVG never actually rendered
  // larger and zooming just panned it (reported on GB-941).
  test('zooming past the viewport actually enlarges the image (not clamped to the canvas)', async ({ page }) => {
    await openRenderedSvg(page);
    const cw = await canvasWidth(page);
    expect(cw).toBeGreaterThan(0);

    // Zoom in until the wrapper should exceed the canvas (or we hit the cap).
    const zoomIn = page.locator('.diff-toolbar-image [data-zoom-action="in"]');
    for (let i = 0; i < 6; i++) await zoomIn.click();

    // The wrapper's real layout width must exceed the canvas — proof it was not
    // shrunk back to fit.
    await expect.poll(() => wrapLayoutWidth(page), { timeout: 5000 }).toBeGreaterThan(cw + 1);

    // The rendered <img> itself is genuinely larger than the viewport.
    const imgBox = await page.locator('[data-panel="difference"] .image-layer-old').boundingBox();
    if (!imgBox) throw new Error('image layer has no box');
    expect(imgBox.width).toBeGreaterThan(cw);
  });

  test('raster images still zoom via transform scale (layout size constant)', async ({ page }) => {
    // Regression guard: the PNG path must keep the cheap transform-scale model.
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-item .file-name', { hasText: '128x128.png' }).click();
    await expect(page.locator('.image-diff')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-image-mode="difference"]').click();
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('[data-panel="difference"] .image-layer-old');
      return img !== null && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 10000 });

    const base = await wrapLayoutWidth(page);
    expect(base).toBeGreaterThan(0);
    await expect(page.locator('[data-panel="difference"] .image-zoom-wrap'))
      .not.toHaveAttribute('data-vector-zoom', 'true');

    const zoomIn = page.locator('.diff-toolbar-image [data-zoom-action="in"]');
    await zoomIn.click();
    await zoomIn.click();

    // Layout size unchanged; the transform carries the scale.
    expect(Math.abs((await wrapLayoutWidth(page)) - base)).toBeLessThan(2);
    const transform = await page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>('[data-panel="difference"] .image-zoom-wrap');
      return wrap ? wrap.style.transform : '';
    });
    expect(transform).toContain('scale(');
  });
});
