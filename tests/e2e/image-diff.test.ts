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
