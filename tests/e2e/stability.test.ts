import { expect, test } from './coverage-fixture.js';
import { expectStableHeap } from './memoryHelper.js';

/**
 * Memory-stability tests. These exercise the interaction loops most
 * likely to leak in this codebase — kerf `mount()` trees, `delegate()`
 * listener bindings, fire-and-forget fetches, and analysis-mode
 * polling — and assert that repeated execution doesn't grow the JS heap
 * proportionally with the loop count. A real leak (per-iteration DOM
 * retention, accumulated event handlers) shows up as MB-scale growth
 * over a few dozen iterations; the budgets below are deliberately loose
 * so V8 measurement noise doesn't flake them, but tight enough to catch
 * a regression of the GB-800 / GB-748 / GB-789 class.
 *
 * The tests intentionally use small iteration counts (10–25) so each
 * runs in well under the suite's 30 s timeout while still surfacing any
 * order-of-magnitude growth.
 */

async function gotoReview(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
}

test.describe('Memory stability', () => {
  test('repeated diff file switching does not leak', async ({ page }) => {
    await gotoReview(page);

    // Snapshot the first two distinct file paths from the sidebar.
    // Demo mode always has at least four; we pick the first two to give
    // us a deterministic A/B switch target.
    const items = page.locator('.file-item');
    await expect(items.first()).toBeVisible({ timeout: 5000 });
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(2);

    const switchAB = async () => {
      await items.nth(0).click();
      await expect(page.locator('.diff-header .file-path')).toBeVisible({ timeout: 3000 });
      await items.nth(1).click();
      await expect(page.locator('.diff-header .file-path')).toBeVisible({ timeout: 3000 });
    };

    // 15 A→B→A→B cycles. Each one tears down the diff mount tree,
    // re-renders, re-binds delegate handlers, and re-runs the outline
    // effect. A leak in any of those paths multiplies the heap by the
    // file's serialized HTML size per iteration; demo files are small
    // enough that the per-cycle budget below catches a real regression
    // without flaking on V8 lazy accounting.
    await expectStableHeap(page, switchAB, {
      iterations: 15,
      warmupCycles: 2,
      perIterationBytes: 200 * 1024,
      absoluteFloorBytes: 3 * 1024 * 1024,
      label: 'diff file switching',
    });
  });

  test('repeated settings dialog open+close does not leak', async ({ page }) => {
    await gotoReview(page);

    const settingsBtn = page.locator('.settings-gear').first();
    if (await settingsBtn.count() === 0) {
      test.skip(true, 'no settings entry point in this build');
    }

    const openClose = async () => {
      await settingsBtn.click();
      const modal = page.locator('.modal-overlay, .settings-dialog').first();
      await expect(modal).toBeVisible({ timeout: 2000 });
      await page.keyboard.press('Escape');
      await expect(modal).not.toBeVisible({ timeout: 2000 });
    };

    // The settings dialog mounts a kerf tree on open and disposes on
    // close; the per-tab signals, effects, and delegate handlers should
    // all release. 10 cycles is enough to surface a stuck mount.
    await expectStableHeap(page, openClose, {
      iterations: 10,
      warmupCycles: 1,
      perIterationBytes: 150 * 1024,
      absoluteFloorBytes: 2 * 1024 * 1024,
      label: 'settings dialog open+close',
    });
  });

  test('repeated sort-mode switching does not leak', async ({ page }) => {
    await gotoReview(page);

    // Sort mode control lives in the sidebar header. The buttons may
    // not be present in every demo scenario (e.g. when AI is disabled)
    // — skip rather than flake.
    const folderBtn = page.locator('[data-sort-mode="folder"]');
    const riskBtn = page.locator('[data-sort-mode="risk"]');
    const narrativeBtn = page.locator('[data-sort-mode="narrative"]');
    if (await folderBtn.count() === 0 || await riskBtn.count() === 0 || await narrativeBtn.count() === 0) {
      test.skip(true, 'sort-mode control not present in this demo scenario');
    }

    const cycle = async () => {
      await folderBtn.click();
      // The file-list mount re-renders synchronously after the click; we
      // wait for the DOM to settle before the next switch by polling for
      // the first file-item to be attached again.
      await expect(page.locator('.file-item').first()).toBeVisible({ timeout: 2000 });
      await riskBtn.click();
      await expect(page.locator('.file-item').first()).toBeVisible({ timeout: 2000 });
      await narrativeBtn.click();
      await expect(page.locator('.file-item').first()).toBeVisible({ timeout: 2000 });
    };

    // 10 cycles × 3 switches = 30 sidebar mount re-renders. A leak in
    // the sort-control mount, the file-list mount, or the analysis-poll
    // generation counter would compound fast.
    await expectStableHeap(page, cycle, {
      iterations: 10,
      warmupCycles: 1,
      perIterationBytes: 250 * 1024,
      absoluteFloorBytes: 3 * 1024 * 1024,
      label: 'sort-mode switching',
    });
  });
});
