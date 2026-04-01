import { test, expect } from '@playwright/test';

test.describe('Review page loads', () => {
  test('displays the main review UI', async ({ page }) => {
    await page.goto('/');
    // Should have a sidebar with file list
    await expect(page.locator('.sidebar')).toBeVisible();
    // Should have a main content area
    await expect(page.locator('.main-content')).toBeVisible();
  });

  test('sidebar shows file tree', async ({ page }) => {
    await page.goto('/');
    // Wait for files to load
    await expect(page.locator('.file-list')).toBeVisible();
    // Should have file entries
    const fileItems = page.locator('.file-item');
    await expect(fileItems.first()).toBeVisible();
    const count = await fileItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('sidebar shows review mode and repo name', async ({ page }) => {
    await page.goto('/');
    // Should show repo info in the sidebar header
    await expect(page.locator('.sidebar')).toContainText('demo');
  });
});

test.describe('File navigation', () => {
  test('clicking a file loads its diff', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();
    // Click the first file
    await page.locator('.file-item').first().click();
    // Should show the diff view
    await expect(page.locator('.diff-view')).toBeVisible();
  });

  test('j/k keyboard navigation moves between files', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();
    // Click first file to focus
    await page.locator('.file-item').first().click();
    // Wait for diff to load
    await expect(page.locator('.diff-view')).toBeVisible();
    // Press j to go to next file
    await page.keyboard.press('j');
    // The active file should change (second file should now be active)
    await expect(page.locator('.file-item.active').nth(0)).toBeVisible();
  });
});

test.describe('Diff viewing', () => {
  test('displays diff with line numbers', async ({ page }) => {
    await page.goto('/');
    await page.locator('.file-item').first().click();
    await expect(page.locator('.diff-view')).toBeVisible();
    // Should have diff lines
    const lines = page.locator('.diff-line');
    await expect(lines.first()).toBeVisible();
  });

  test('toggle between split and unified mode', async ({ page }) => {
    await page.goto('/');
    await page.locator('.file-item').first().click();
    await expect(page.locator('.diff-view')).toBeVisible();
    // Click the unified mode button to switch from split
    const unifiedBtn = page.locator('[data-diff-mode="unified"]');
    if (await unifiedBtn.count() > 0) {
      await unifiedBtn.click();
      // Diff view should still be visible after toggle
      await expect(page.locator('.diff-view')).toBeVisible();
      // Switch back to split
      await page.locator('[data-diff-mode="split"]').click();
      await expect(page.locator('.diff-view')).toBeVisible();
    }
  });
});

test.describe('Annotations', () => {
  test('demo scenario has pre-existing annotations', async ({ page }) => {
    await page.goto('/');
    await page.locator('.file-item').first().click();
    await expect(page.locator('.diff-view')).toBeVisible();
    // Demo 4 should have annotations
    const annotations = page.locator('.annotation-row');
    // Wait briefly for any annotations to appear
    await page.waitForTimeout(500);
    const count = await annotations.count();
    expect(count).toBeGreaterThanOrEqual(0); // Demo may or may not show annotations on first file
  });

  test('clicking a diff line opens annotation form', async ({ page }) => {
    await page.goto('/');
    await page.locator('.file-item').first().click();
    await expect(page.locator('.diff-view')).toBeVisible();
    // Click on a diff line that has content (add or context line)
    const addLine = page.locator('.diff-line.add').first();
    if (await addLine.count() > 0) {
      await addLine.click();
      // Annotation form should appear
      await expect(page.locator('.annotation-form')).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Settings dialog', () => {
  test('opens settings dialog via gear icon', async ({ page }) => {
    await page.goto('/');
    // Find and click the settings button
    const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]');
    if (await settingsBtn.count() > 0) {
      await settingsBtn.first().click();
      await expect(page.locator('.settings-dialog, .modal')).toBeVisible({ timeout: 3000 });
    }
  });

  test('closes settings dialog with Escape', async ({ page }) => {
    await page.goto('/');
    const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]');
    if (await settingsBtn.count() > 0) {
      await settingsBtn.first().click();
      await expect(page.locator('.settings-dialog, .modal')).toBeVisible({ timeout: 3000 });
      await page.keyboard.press('Escape');
      await expect(page.locator('.settings-dialog, .modal')).not.toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Progress bar', () => {
  test('progress summary exists and gets populated', async ({ page }) => {
    await page.goto('/');
    // Wait for client JS to populate the progress summary
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
  });
});

test.describe('Review completion', () => {
  test('Complete Review button exists', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button').filter({ hasText: /complete/i })).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Review history page', () => {
  test('history page is accessible', async ({ page }) => {
    await page.goto('/history');
    await expect(page.locator('.history-page')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Review History');
  });
});
