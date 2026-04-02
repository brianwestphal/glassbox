import { test, expect } from './coverage-fixture.js';

test.describe('Review completion', () => {
  test('Complete Review button is visible', async ({ page }) => {
    await page.goto('/');
    const completeBtn = page.locator('button').filter({ hasText: /complete/i });
    await expect(completeBtn).toBeVisible({ timeout: 5000 });
  });

  test('clicking Complete Review triggers completion flow', async ({ page }) => {
    await page.goto('/');
    // Wait for client JS to bind the click handler
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    const completeBtn = page.locator('#complete-review');
    await expect(completeBtn).toBeVisible();
    await completeBtn.click();
    // The completion flow creates a modal overlay (either stale prompt or "Completing..." then result)
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Review history', () => {
  test('history page shows review entries', async ({ page }) => {
    await page.goto('/history');
    await expect(page.locator('.history-page')).toBeVisible();
    const historyItems = page.locator('.history-item');
    await expect(historyItems.first()).toBeVisible({ timeout: 5000 });
    const count = await historyItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('history entries show repo name and status', async ({ page }) => {
    await page.goto('/history');
    await expect(page.locator('.history-page')).toBeVisible();
    const firstItem = page.locator('.history-item').first();
    await expect(firstItem).toBeVisible({ timeout: 5000 });
    // Each history item has heading with repo info
    await expect(firstItem.locator('h3')).toContainText('demo');
    // Status badge should exist
    await expect(firstItem.locator('.status-badge').first()).toBeVisible();
  });
});
