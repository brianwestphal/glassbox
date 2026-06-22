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
