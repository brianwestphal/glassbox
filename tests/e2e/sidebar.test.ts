import { test, expect } from './coverage-fixture.js';

test.describe('File filter', () => {
  test('filters files by name and clears to restore all', async ({ page }) => {
    await page.goto('/');
    // Wait for client JS to fully render the file list
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    const allCount = await page.locator('.file-item').count();
    expect(allCount).toBeGreaterThan(1);

    // Focus the filter and type to filter
    const filterInput = page.locator('#file-filter');
    await filterInput.focus();
    await filterInput.fill('package');
    await filterInput.dispatchEvent('input');
    // "package" should match only package.json (1 file)
    await expect(page.locator('.file-item')).toHaveCount(1, { timeout: 3000 });

    // Press Escape to clear filter (the keydown handler clears and re-renders)
    await filterInput.focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('.file-item')).toHaveCount(allCount, { timeout: 3000 });
  });
});

test.describe('Folder tree', () => {
  test('folder headers exist', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    const folderHeaders = page.locator('.folder-header');
    const count = await folderHeaders.count();
    expect(count).toBeGreaterThan(0);
  });

  test('collapse and expand a folder', async ({ page }) => {
    await page.goto('/');
    // Wait for client JS to render the file list and bind click handlers
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    const collapsible = page.locator('.folder-header.collapsible').first();
    if (await collapsible.count() === 0) return;

    // Click the folder header to collapse
    await collapsible.click();
    await expect(collapsible).toHaveClass(/collapsed/, { timeout: 2000 });

    // Click again to expand
    await collapsible.click();
    await expect(collapsible).not.toHaveClass(/collapsed/, { timeout: 2000 });
  });
});

test.describe('File status', () => {
  test('status dots exist on file items', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    const statusDots = page.locator('.file-item .status-dot');
    const count = await statusDots.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking a file loads its diff and marks it reviewed', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    // Click a file to load its diff
    const firstFile = page.locator('.file-item').first();
    await firstFile.click();
    await expect(page.locator('.diff-view')).toBeVisible();

    // After visiting, the file's status dot should reflect "reviewed"
    const statusDot = firstFile.locator('.status-dot');
    await expect(statusDot).toHaveClass(/reviewed/);
  });
});

test.describe('Progress bar', () => {
  test('progress summary shows file count info', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/\d+ of \d+ files reviewed/, { timeout: 5000 });
  });
});

test.describe('Active file highlighting', () => {
  test('clicking a file gives it active class, clicking another transfers it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    const fileItems = page.locator('.file-item');
    const count = await fileItems.count();
    expect(count).toBeGreaterThan(1);

    // Click the first file
    const firstFile = fileItems.nth(0);
    await firstFile.click();
    await expect(page.locator('.diff-view')).toBeVisible();
    await expect(firstFile).toHaveClass(/active/);

    // Click the second file
    const secondFile = fileItems.nth(1);
    await secondFile.click();
    await expect(secondFile).toHaveClass(/active/);
    await expect(firstFile).not.toHaveClass(/active/);
  });
});

test.describe('Sort mode control', () => {
  test('segmented control has Folder, Risk, and Narrative buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    const folderBtn = page.locator('[data-sort-mode="folder"]');
    const riskBtn = page.locator('[data-sort-mode="risk"]');
    const narrativeBtn = page.locator('[data-sort-mode="narrative"]');

    await expect(folderBtn).toBeVisible();
    await expect(riskBtn).toBeVisible();
    await expect(narrativeBtn).toBeVisible();

    // Folder mode should be active by default
    await expect(folderBtn).toHaveClass(/active/);
  });
});
