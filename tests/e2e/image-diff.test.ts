import { test, expect } from './coverage-fixture.js';
import { waitForStableBox } from './stableBox.js';

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

  // GB-956 regression guard: the image-feedback edit/delete icon buttons must
  // work. A click lands on the lucide `<svg>` inside the button (an SVGElement),
  // which the panel handler's old `instanceof HTMLElement` guard rejected,
  // silently dropping edit/delete after the glyphs became icons (GB-952).
  test('the edit icon button on an image-feedback comment opens its inline editor', async ({ page }) => {
    await openImageDiff(page);
    const panel = page.locator('[data-image-feedback]');
    await expect(panel.locator('[data-role="general-input"]')).toBeVisible({ timeout: 5000 });
    const marker = `edit-icon-${Date.now().toString(36)}`;
    await panel.locator('[data-role="general-input"]').fill(marker);
    await panel.locator('[data-action="add-general"]').click();
    const item = panel.locator('.image-feedback-item', { hasText: marker });
    await expect(item).toBeVisible({ timeout: 5000 });

    // Click the edit button's inner icon (the SVGElement target).
    await item.locator('[data-action="edit"] svg').click();
    await expect(item.locator('[data-role="edit-input"]')).toBeVisible({ timeout: 5000 });

    // Cleanup: cancel the editor, then delete the comment (also via its icon).
    await item.locator('[data-action="cancel-edit"]').click();
    await item.locator('[data-action="delete"]').click();
    await expect(panel.locator('.image-feedback-item', { hasText: marker })).toHaveCount(0, { timeout: 5000 });
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

    // `.last()` = the region we just drew (regions render in creation order).
    // Regions persist in the shared demo DB with no per-test cleanup, so a retry
    // after a failure can leave an earlier same-comment region behind; scoping to
    // the newest avoids a strict-mode "resolved to N elements" cascade (GB-1030).
    const row = page.locator('[data-list="regions"] .image-feedback-item', { hasText: comment }).last();
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

    // Grab the interior (center) and drag right + down. On mouse-up the app persists
    // the new geometry as a fire-and-forget PATCH /annotations/:id/region; wait for
    // that response before reloading, otherwise the reload can race the save and read
    // the pre-move position (a flake that only surfaced on slow CI — GB-1030).
    const geomSaved = page.waitForResponse(
      // URL is `/api/annotations/<id>/region?reviewId=…` — match `/region` before the query.
      (r) => /\/annotations\/[^/]+\/region(\?|$)/.test(r.url()) && r.request().method() === 'PATCH',
    );
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 40, { steps: 10 });
    await page.mouse.up();
    await geomSaved;

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
    // `.last()` = the region we just drew (regions render in creation order).
    // Regions persist in the shared demo DB with no per-test cleanup, so a retry
    // after a failure can leave an earlier same-comment region behind; scoping to
    // the newest avoids a strict-mode "resolved to N elements" cascade (GB-1030).
    const row = page.locator('[data-list="regions"] .image-feedback-item', { hasText: comment }).last();
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

  // GB-941 follow-up: once zoomed past the viewport, the image must be pannable.
  test('a zoomed SVG can be panned', async ({ page }) => {
    await openRenderedSvg(page);

    const zoomIn = page.locator('.diff-toolbar-image [data-zoom-action="in"]');
    for (let i = 0; i < 6; i++) await zoomIn.click();

    const img = page.locator('[data-panel="difference"] .image-layer-old');
    const before = await img.boundingBox();
    const canvas = page.locator('[data-panel="difference"] .image-visual-canvas');
    const cbox = await canvas.boundingBox();
    if (!before || !cbox) throw new Error('missing boxes');

    // Drag from the canvas center toward the top-left.
    const cx = cbox.x + cbox.width / 2;
    const cy = cbox.y + cbox.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 120, cy - 90, { steps: 10 });
    await page.mouse.up();

    const after = await img.boundingBox();
    if (!after) throw new Error('image vanished after pan');
    // The image actually moved with the drag (up and to the left).
    expect(after.x).toBeLessThan(before.x - 20);
    expect(after.y).toBeLessThan(before.y - 20);
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

// GB-942 — macOS trackpad gestures: pinch (wheel + ctrlKey) zooms, a plain
// two-finger swipe (wheel without ctrlKey) pans. Verified on the raster image
// since the wheel handler is shared by raster and SVG.
test.describe('Zoom/pan gestures (GB-942)', () => {
  async function openDifference(page: import('@playwright/test').Page) {
    await openImageDiff(page);
    await page.locator('[data-image-mode="difference"]').click();
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('[data-panel="difference"] .image-layer-old');
      return img !== null && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 10000 });
  }

  async function wheel(page: import('@playwright/test').Page, opts: { dy?: number; dx?: number; ctrl?: boolean }) {
    await page.evaluate((o) => {
      const canvas = document.querySelector<HTMLElement>('[data-panel="difference"] .image-visual-canvas');
      if (canvas === null) throw new Error('no visible canvas');
      const r = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaX: o.dx ?? 0,
        deltaY: o.dy ?? 0,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        ctrlKey: o.ctrl ?? false,
        bubbles: true,
        cancelable: true,
      }));
    }, opts);
  }

  function imgBox(page: import('@playwright/test').Page) {
    return page.locator('[data-panel="difference"] .image-layer-old').boundingBox();
  }

  test('pinch (ctrl+wheel) zooms in', async ({ page }) => {
    await openDifference(page);
    const before = await imgBox(page);
    if (!before) throw new Error('no image box');

    // Pinch-out arrives as ctrl+wheel with negative deltaY.
    for (let i = 0; i < 4; i++) await wheel(page, { dy: -100, ctrl: true });

    await expect.poll(async () => (await imgBox(page))?.width ?? 0, { timeout: 5000 })
      .toBeGreaterThan(before.width + 20);
  });

  test('a plain two-finger swipe pans once zoomed (and does nothing at fit)', async ({ page }) => {
    await openDifference(page);

    // At fit (zoom 1) a swipe must not move or zoom anything. Read the box only once
    // it's settled — the difference image reflows to fit/center after loading, and a
    // mid-reflow read made this see a ~39px layout shift as a phantom pan (GB-1031).
    const oldLayer = page.locator('[data-panel="difference"] .image-layer-old');
    const atFit = await waitForStableBox(oldLayer);
    await wheel(page, { dy: 120 });
    const stillFit = await waitForStableBox(oldLayer);
    expect(Math.abs(stillFit.y - atFit.y)).toBeLessThan(2);
    expect(Math.abs(stillFit.width - atFit.width)).toBeLessThan(2);

    // Zoom in (pinch), then a plain swipe pans — it must not change the zoom.
    for (let i = 0; i < 5; i++) await wheel(page, { dy: -100, ctrl: true });
    const zoomed = await imgBox(page);
    if (!zoomed) throw new Error('no image box');

    await wheel(page, { dy: 150 });
    await expect.poll(async () => (await imgBox(page))?.y ?? 0, { timeout: 5000 })
      .toBeLessThan(zoomed.y - 20);
    // Width unchanged — the swipe panned, it did not zoom.
    const afterPan = await imgBox(page);
    if (!afterPan) throw new Error('no image box');
    expect(Math.abs(afterPan.width - zoomed.width)).toBeLessThan(2);
  });
});

// Doc 24 — side-by-side image comparison with a left-right / over-under sub-option.
test.describe('Side-by-side image comparison (doc 24)', () => {
  const IMG = '128x128.png';

  async function openSxs(page: import('@playwright/test').Page) {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-item .file-name', { hasText: IMG }).click();
    await expect(page.locator('.image-diff')).toBeVisible({ timeout: 5000 });
    // Default mode for a two-sided image is side-by-side; make sure it's active
    // regardless of what an earlier test left persisted.
    await page.locator('[data-image-mode="side-by-side"]').click();
    await expect(page.locator('[data-panel="side-by-side"]')).toHaveClass(/active/, { timeout: 5000 });
  }

  // The default mode (side-by-side) is asserted at the unit level — the demo
  // server is shared and earlier specs persist `last_image_mode`, so the default
  // isn't observable here. This test covers the functional behavior: both panes
  // render both images, and each pane is sized to its OWN image (the demo's old
  // and new icons are 64px and 128px — different sizes that must not be forced
  // to a shared aspect ratio).
  test('shows both old and new panes, each sized to its own image', async ({ page }) => {
    await openSxs(page);
    const panel = page.locator('[data-panel="side-by-side"]');
    await expect(panel.locator('[data-sxs-pane="old"] .image-layer-old')).toBeVisible();
    await expect(panel.locator('[data-sxs-pane="new"] .image-layer-new')).toBeVisible();

    // Each pane's zoom-wrap is sized from its own image's aspect ratio. Both demo
    // icons are square, so each wrap must be (near) square — proof the new pane
    // wasn't stretched to the old image's box (and vice versa).
    const square = await page.evaluate(() => {
      const ratio = (sel: string) => {
        const w = document.querySelector<HTMLElement>(`[data-sxs-pane="${sel}"] .image-zoom-wrap`);
        if (!w || w.offsetWidth === 0 || w.offsetHeight === 0) return null;
        return w.offsetWidth / w.offsetHeight;
      };
      return { old: ratio('old'), new: ratio('new') };
    });
    expect(square.old).not.toBeNull();
    expect(square.new).not.toBeNull();
    expect(Math.abs((square.old ?? 0) - 1)).toBeLessThan(0.1);
    expect(Math.abs((square.new ?? 0) - 1)).toBeLessThan(0.1);
  });

  test('the orientation sub-control only shows in side-by-side mode', async ({ page }) => {
    await openSxs(page);
    await expect(page.locator('[data-sxs-orient-control]')).toBeVisible();
    // Switch to another mode — the sub-control hides.
    await page.locator('[data-image-mode="difference"]').click();
    await expect(page.locator('[data-sxs-orient-control]')).toBeHidden();
  });

  test('switching to over-under flips the panel layout and persists across reload', async ({ page }) => {
    await openSxs(page);
    const panel = page.locator('[data-panel="side-by-side"]');
    await expect(panel).toHaveAttribute('data-sxs-orientation', 'left-right');

    await page.locator('[data-sxs-orient="over-under"]').click();
    await expect(panel).toHaveAttribute('data-sxs-orientation', 'over-under');

    // The two panes are now stacked vertically (new pane below the old pane).
    const stacked = await page.evaluate(() => {
      const a = document.querySelector('[data-sxs-pane="old"]')?.getBoundingClientRect();
      const b = document.querySelector('[data-sxs-pane="new"]')?.getBoundingClientRect();
      if (!a || !b) return null;
      return { stacked: b.top >= a.bottom - 1, sameRow: Math.abs(a.top - b.top) < 1 };
    });
    expect(stacked?.stacked).toBe(true);
    expect(stacked?.sameRow).toBe(false);

    // Persisted: reopen and the orientation is still over-under.
    await openSxs(page);
    await expect(page.locator('[data-panel="side-by-side"]'))
      .toHaveAttribute('data-sxs-orientation', 'over-under', { timeout: 5000 });

    // Reset to the default so later tests start from left-right.
    await page.locator('[data-sxs-orient="left-right"]').click();
    await expect(page.locator('[data-panel="side-by-side"]'))
      .toHaveAttribute('data-sxs-orientation', 'left-right');
  });

  test('a region can be drawn on the new (B) pane and persists', async ({ page }) => {
    await openSxs(page);
    await page.locator('[data-action="toggle-draw"]').click();
    const overlay = page.locator('[data-sxs-pane="new"] [data-region-overlay]');
    const box = await overlay.boundingBox();
    if (!box) throw new Error('new-pane overlay has no box');
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 8 });
    await page.mouse.up();

    const comment = 'B pane region from side-by-side';
    const pendingInput = page.locator('[data-role="pending-input"]');
    await expect(pendingInput).toBeVisible({ timeout: 5000 });
    await pendingInput.fill(comment);
    await page.locator('[data-action="save-pending"]').click();

    // `.last()` = the region we just drew (regions render in creation order).
    // Regions persist in the shared demo DB with no per-test cleanup, so a retry
    // after a failure can leave an earlier same-comment region behind; scoping to
    // the newest avoids a strict-mode "resolved to N elements" cascade (GB-1030).
    const row = page.locator('[data-list="regions"] .image-feedback-item', { hasText: comment }).last();
    await expect(row).toBeVisible({ timeout: 5000 });
    const id = await row.getAttribute('data-id');
    if (id === null || id === 'pending') throw new Error(`region row has no saved id (${id})`);
    // The box renders on a side-by-side pane overlay.
    await expect(page.locator(`[data-panel="side-by-side"] .region-box[data-region-id="${id}"]`).first())
      .toBeVisible({ timeout: 5000 });

    // Persists across reload.
    await openSxs(page);
    await expect(page.locator('[data-list="regions"] .image-feedback-item', { hasText: comment }))
      .toBeVisible({ timeout: 5000 });
  });

  // GB-951: "Actual size" must make BOTH panes 1:1 to their own image, not just
  // the first. The demo's old/new icons are 64px and 128px — different sizes, so
  // the bug (only the A pane went 1:1) is observable here.
  test('"Actual size" makes each pane 1:1 to its own image', async ({ page }) => {
    await openSxs(page);
    // Both images must be loaded before "actual size" can read their natural size.
    await page.waitForFunction(() => {
      const a = document.querySelector<HTMLImageElement>('[data-sxs-pane="old"] .image-layer-old');
      const b = document.querySelector<HTMLImageElement>('[data-sxs-pane="new"] .image-layer-new');
      return a !== null && a.complete && a.naturalWidth > 0
        && b !== null && b.complete && b.naturalWidth > 0;
    }, null, { timeout: 10000 });

    await page.locator('.diff-toolbar-image [data-zoom-action="actual"]').click();

    const sizes = await page.evaluate(() => {
      const wrapW = (pane: string) => {
        const w = document.querySelector<HTMLElement>(`[data-sxs-pane="${pane}"] .image-zoom-wrap`);
        return w ? Math.round(w.offsetWidth) : 0;
      };
      const natW = (pane: string, cls: string) => {
        const i = document.querySelector<HTMLImageElement>(`[data-sxs-pane="${pane}"] .${cls}`);
        return i ? i.naturalWidth : 0;
      };
      return {
        oldWrap: wrapW('old'), newWrap: wrapW('new'),
        oldNat: natW('old', 'image-layer-old'), newNat: natW('new', 'image-layer-new'),
      };
    });

    // The demo icons are genuinely different sizes — this is the bug's trigger.
    expect(sizes.oldNat).not.toBe(sizes.newNat);
    // Each pane's wrap is sized to its OWN image's natural width (1:1).
    expect(sizes.oldWrap).toBe(sizes.oldNat);
    expect(sizes.newWrap).toBe(sizes.newNat);
  });
});

// Doc 28 — single-side focus: "A" and "B" modes that show only one side at a time.
test.describe('Single-side image focus (doc 28)', () => {
  const IMG = '128x128.png';

  async function openImg(page: import('@playwright/test').Page) {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-item .file-name', { hasText: IMG }).click();
    await expect(page.locator('.image-diff')).toBeVisible({ timeout: 5000 });
  }

  test('A and B segments appear between Metadata and Side by Side for a two-sided image', async ({ page }) => {
    await openImg(page);
    await expect(page.locator('[data-image-mode="a"]')).toBeVisible();
    await expect(page.locator('[data-image-mode="b"]')).toBeVisible();
    // Order within the segmented control: Metadata, A, B, Side by Side, ...
    const order = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.diff-toolbar-image [data-image-mode]'));
      return btns.map((b) => (b as HTMLElement).dataset.imageMode);
    });
    expect(order.indexOf('metadata')).toBeLessThan(order.indexOf('a'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('side-by-side'));
  });

  test('selecting A shows only the old image; B shows only the new', async ({ page }) => {
    await openImg(page);

    await page.locator('[data-image-mode="a"]').click();
    await expect(page.locator('[data-panel="a"]')).toHaveClass(/active/, { timeout: 5000 });
    // Only the A panel is visible; side-by-side / B / difference are not.
    await expect(page.locator('[data-panel="a"] .image-layer-old')).toBeVisible();
    await expect(page.locator('[data-panel="b"]')).toBeHidden();
    await expect(page.locator('[data-panel="side-by-side"]')).toBeHidden();
    // The side-by-side orientation sub-control is hidden outside side-by-side mode.
    await expect(page.locator('[data-sxs-orient-control]')).toBeHidden();

    await page.locator('[data-image-mode="b"]').click();
    await expect(page.locator('[data-panel="b"]')).toHaveClass(/active/, { timeout: 5000 });
    await expect(page.locator('[data-panel="b"] .image-layer-new')).toBeVisible();
    await expect(page.locator('[data-panel="a"]')).toBeHidden();
    await expect(page.locator('[data-panel="side-by-side"]')).toBeHidden();
  });

  test('the selected focus mode persists across reload', async ({ page }) => {
    await openImg(page);
    await page.locator('[data-image-mode="a"]').click();
    await expect(page.locator('[data-panel="a"]')).toHaveClass(/active/, { timeout: 5000 });

    await openImg(page);
    await expect(page.locator('[data-panel="a"]')).toHaveClass(/active/, { timeout: 5000 });

    // Reset so later specs start from a known mode.
    await page.locator('[data-image-mode="side-by-side"]').click();
    await expect(page.locator('[data-panel="side-by-side"]')).toHaveClass(/active/, { timeout: 5000 });
  });
});

test.describe('Draw-region button hidden in Metadata mode (GB-1053)', () => {
  test('the draw-region button shows in a comparison mode but is hidden in Metadata', async ({ page }) => {
    await openImageDiff(page);
    // Ensure a comparison mode (not Metadata) is active first.
    await page.locator('[data-image-mode="side-by-side"]').click();
    const drawBtn = page.locator('.image-feedback-draw-btn');
    await expect(drawBtn).toBeVisible();

    // Metadata mode has no canvas to draw on -> the draw affordance is hidden.
    await page.locator('[data-image-mode="metadata"]').click();
    await expect(page.locator('[data-panel="metadata"]')).toHaveClass(/active/);
    await expect(drawBtn).toBeHidden();

    // Back to a comparison mode -> visible again.
    await page.locator('[data-image-mode="side-by-side"]').click();
    await expect(drawBtn).toBeVisible();
  });
});
