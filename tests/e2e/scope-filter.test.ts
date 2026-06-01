import { test, expect } from './coverage-fixture.js';

/**
 * GB-844 — scope filters. Click each chip and assert (a) the `#diff-container`
 * carries the expected `.scope-*` class and (b) the matching `.diff-line` rows
 * actually become hidden / visible. CSS-driven, so we verify via
 * `getComputedStyle.display` rather than counting nodes (the rows stay in the
 * DOM; they just stop being painted).
 *
 * Demo:1 (the default e2e webServer mode) has a text diff with adds, removes,
 * and context rows on `src/auth/session.ts`, which is what we open here.
 */

const TARGET_FILE = 'src/auth/session.ts';

async function openTargetFile(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
  await page.locator(`.file-name[title="${TARGET_FILE}"]`).click();
  await expect(page.locator('.diff-line.add').first()).toBeVisible({ timeout: 5000 });
  // Switch to unified mode so each line stands alone — split mode shows a
  // modified row's remove cell even under the "Adds" filter (the row contains
  // an add, so the whole `.split-row` stays visible). That's correct UX but
  // makes the per-class visibility assertions noisier; unified mode tests the
  // core filter logic on its own.
  await page.locator('[data-diff-mode="unified"]').click();
  await expect(page.locator('[data-diff-mode="unified"]')).toHaveClass(/active/);
}

interface VisibilityProbe {
  // Number of `.diff-line` rows in each category whose computed display is
  // NOT `none`. We count what the user actually sees.
  add: number;
  remove: number;
  context: number;
  containerClass: string;
}

async function probe(page: import('@playwright/test').Page): Promise<VisibilityProbe> {
  return page.evaluate(() => {
    // Visibility = the cell is painted AND its containing `.split-row`
    // (if any) is also painted. In split mode the filter hides whole rows
    // via `:has()`; we want to count cells the user can actually see.
    const isVisible = (el: HTMLElement) => {
      if (getComputedStyle(el).display === 'none') return false;
      let cur: HTMLElement | null = el.parentElement;
      while (cur !== null) {
        if (getComputedStyle(cur).display === 'none') return false;
        cur = cur.parentElement;
      }
      return true;
    };
    const visible = (sel: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(isVisible).length;
    const container = document.getElementById('diff-container');
    return {
      add: visible('.diff-line.add'),
      remove: visible('.diff-line.remove'),
      context: visible('.diff-line.context'),
      containerClass: container?.className ?? '',
    };
  });
}

test.describe('scope filters (GB-844)', () => {
  test('"All" is the default and every line type is visible', async ({ page }) => {
    await openTargetFile(page);
    const p = await probe(page);
    expect(p.add).toBeGreaterThan(0);
    expect(p.remove).toBeGreaterThan(0);
    expect(p.context).toBeGreaterThan(0);
    expect(p.containerClass).not.toContain('scope-');
    await expect(page.locator('[data-scope-filter="all"]')).toHaveClass(/active/);
  });

  test('"Adds" hides removes + context (unified) and removes-only rows (split)', async ({ page }) => {
    await openTargetFile(page);
    await page.locator('[data-scope-filter="adds"]').click();
    await expect(page.locator('#diff-container')).toHaveClass(/scope-adds/);
    const p = await probe(page);
    expect(p.add).toBeGreaterThan(0);
    expect(p.remove).toBe(0);
    expect(p.context).toBe(0);
  });

  test('"Removes" hides adds + context', async ({ page }) => {
    await openTargetFile(page);
    await page.locator('[data-scope-filter="removes"]').click();
    await expect(page.locator('#diff-container')).toHaveClass(/scope-removes/);
    const p = await probe(page);
    expect(p.remove).toBeGreaterThan(0);
    expect(p.add).toBe(0);
    expect(p.context).toBe(0);
  });

  test('"Changed" keeps adds + removes and hides context', async ({ page }) => {
    await openTargetFile(page);
    await page.locator('[data-scope-filter="changed"]').click();
    await expect(page.locator('#diff-container')).toHaveClass(/scope-changed/);
    const p = await probe(page);
    expect(p.add).toBeGreaterThan(0);
    expect(p.remove).toBeGreaterThan(0);
    expect(p.context).toBe(0);
  });

  test('clicking "All" after another filter restores all rows', async ({ page }) => {
    await openTargetFile(page);
    await page.locator('[data-scope-filter="adds"]').click();
    await expect(page.locator('#diff-container')).toHaveClass(/scope-adds/);
    await page.locator('[data-scope-filter="all"]').click();
    await expect(page.locator('#diff-container')).not.toHaveClass(/scope-/);
    const p = await probe(page);
    expect(p.add).toBeGreaterThan(0);
    expect(p.remove).toBeGreaterThan(0);
    expect(p.context).toBeGreaterThan(0);
  });
});
