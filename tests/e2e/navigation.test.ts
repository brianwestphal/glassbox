import { test, expect } from './coverage-fixture.js';

test.describe('Navigation bar', () => {
  test('nav bar appears when a file is loaded', async ({ page }) => {
    await page.goto('/');
    const navBar = page.locator('#diff-nav-bar');
    // Initially hidden
    await expect(navBar).toHaveCSS('display', 'none');
    // Click a file to load it
    await page.locator('.file-item').first().click();
    await expect(page.locator('.diff-view')).toBeVisible();
    // Nav bar should now be visible
    await expect(navBar).not.toHaveCSS('display', 'none');
  });

  test('nav bar shows file path', async ({ page }) => {
    await page.goto('/');
    await page.locator('.file-item').first().click();
    await expect(page.locator('.diff-view')).toBeVisible();
    const navFilePath = page.locator('#nav-file-path');
    // Should contain the file name from the clicked file item
    const fileName = await page.locator('.file-item.active').textContent();
    expect(fileName).toBeTruthy();
    // The nav path should have some text (the file path)
    await expect(navFilePath).not.toBeEmpty();
  });
});

test.describe('Back and forward navigation', () => {
  test('back button navigates to previous file', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    // Navigate to first file
    const firstFile = page.locator('.file-item').nth(0);
    await firstFile.click();
    await expect(page.locator('.diff-view')).toBeVisible();
    const firstFilePath = await page.locator('#nav-file-path').textContent();

    // Navigate to second file
    const secondFile = page.locator('.file-item').nth(1);
    await secondFile.click();
    await expect(page.locator('.diff-view')).toBeVisible();
    const secondFilePath = await page.locator('#nav-file-path').textContent();
    expect(secondFilePath).not.toEqual(firstFilePath);

    // Back button should be enabled
    const backBtn = page.locator('#nav-back-btn');
    await expect(backBtn).not.toHaveClass(/disabled/);

    // Click back
    await backBtn.click();
    // Should return to first file
    await expect(page.locator('#nav-file-path')).toHaveText(firstFilePath!);
  });

  test('forward button navigates after going back', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    // Navigate to first file, then second file
    await page.locator('.file-item').nth(0).click();
    await expect(page.locator('.diff-view')).toBeVisible();

    await page.locator('.file-item').nth(1).click();
    await expect(page.locator('.diff-view')).toBeVisible();
    const secondFilePath = await page.locator('#nav-file-path').textContent();

    // Go back
    await page.locator('#nav-back-btn').click();
    await expect(page.locator('#nav-back-btn')).toHaveClass(/disabled/);

    // Forward button should be enabled
    const fwdBtn = page.locator('#nav-forward-btn');
    await expect(fwdBtn).not.toHaveClass(/disabled/);

    // Click forward
    await fwdBtn.click();
    // Should return to second file
    await expect(page.locator('#nav-file-path')).toHaveText(secondFilePath!);
  });

  test('back button works through multiple files', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    // Navigate through 3 files
    const filePaths: string[] = [];
    for (let i = 0; i < 3; i++) {
      await page.locator('.file-item').nth(i).click();
      await expect(page.locator('.diff-view')).toBeVisible();
      const path = await page.locator('#nav-file-path').textContent();
      filePaths.push(path!);
    }

    // Verify we have 3 distinct files
    expect(new Set(filePaths).size).toBe(3);

    // Go back to second file
    await page.locator('#nav-back-btn').click();
    await expect(page.locator('#nav-file-path')).toHaveText(filePaths[1]);

    // Go back to first file
    await page.locator('#nav-back-btn').click();
    await expect(page.locator('#nav-file-path')).toHaveText(filePaths[0]);

    // Back button should now be disabled (at the beginning of the stack)
    await expect(page.locator('#nav-back-btn')).toHaveClass(/disabled/);
  });
});
