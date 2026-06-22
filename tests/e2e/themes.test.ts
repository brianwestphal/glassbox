import { test, expect } from './coverage-fixture.js';

test.describe('Theme system', () => {

  // The demo server keeps the active theme in a single shared config dir for the
  // whole suite, so whatever theme a test switches to persists into the next
  // one. Reset to the dark default before each test so assertions that compare
  // against the default (e.g. the initial `--bg` in the switch test) are
  // order-independent rather than depending on what ran before.
  test.beforeEach(async ({ request }) => {
    await request.post('/api/themes/active', { data: { id: 'dark' } });
  });

  test('settings dialog shows theme dropdown with built-in themes', async ({ page }) => {
    await page.goto('/');
    // Open settings dialog
    const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]');
    await settingsBtn.first().click();
    await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });

    // Ensure General tab is active (it should be by default)
    const generalTab = page.locator('[data-tab="general"]');
    await generalTab.click();
    await expect(page.locator('[data-panel="general"].active')).toBeVisible();

    // Verify theme dropdown is visible with at least 6 options
    const themeSelect = page.locator('#settings-theme');
    await expect(themeSelect).toBeVisible();
    const options = themeSelect.locator('option:not([disabled])');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(6);

    // Verify the known built-in theme names are present
    const optionTexts = await options.allTextContents();
    const names = optionTexts.map(t => t.trim());
    expect(names).toContain('Dark');
    expect(names).toContain('Light');
    expect(names).toContain('High Contrast Dark');
    expect(names).toContain('High Contrast Light');
    expect(names).toContain('Dracula');
    expect(names).toContain('Tokyo Night');
  });

  test('switching theme via dropdown changes CSS variables', async ({ page }) => {
    await page.goto('/');
    const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]');
    await settingsBtn.first().click();
    await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });

    const generalTab = page.locator('[data-tab="general"]');
    await generalTab.click();

    // Read the initial --bg value (should be dark by default)
    const initialBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );

    // Select "Light" theme by its known value
    const themeSelect = page.locator('#settings-theme');
    await themeSelect.selectOption('light');

    // Wait for the theme to apply
    await page.waitForFunction(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#ffffff'
    , undefined, { timeout: 5000 });

    const newBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(newBg).toBe('#ffffff');
    expect(newBg).not.toBe(initialBg);
  });

  test('theme persists after page reload', async ({ page }) => {
    await page.goto('/');

    // Open settings and switch to Light
    const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]');
    await settingsBtn.first().click();
    await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-tab="general"]').click();

    const themeSelect = page.locator('#settings-theme');
    await themeSelect.selectOption('light');

    // Wait for theme to apply
    await page.waitForFunction(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#ffffff'
    , undefined, { timeout: 5000 });

    // Reload the page
    await page.reload();
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 5000 });

    // Verify --bg is still the Light value after reload
    const bgAfterReload = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(bgAfterReload).toBe('#ffffff');
  });

  test('Manage Themes dialog opens with theme items and swatches', async ({ page }) => {
    await page.goto('/');
    const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]');
    await settingsBtn.first().click();
    await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-tab="general"]').click();

    // Click Manage Themes button
    await page.locator('#manage-themes-btn').click();
    await expect(page.locator('.theme-manager-dialog')).toBeVisible({ timeout: 5000 });

    // Verify theme items exist
    const items = page.locator('.theme-manager-item');
    const itemCount = await items.count();
    expect(itemCount).toBeGreaterThanOrEqual(6);

    // Verify swatches exist
    const swatches = page.locator('.theme-swatch');
    const swatchCount = await swatches.count();
    expect(swatchCount).toBeGreaterThan(0);
  });

  test('clicking theme name switches the active theme', async ({ page }) => {
    await page.goto('/');
    const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]');
    await settingsBtn.first().click();
    await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-tab="general"]').click();
    await page.locator('#manage-themes-btn').click();
    await expect(page.locator('.theme-manager-dialog')).toBeVisible({ timeout: 5000 });

    // Get the currently active theme id
    const activeItem = page.locator('.theme-manager-item.active');
    await expect(activeItem).toBeVisible();
    const activeId = await activeItem.getAttribute('data-theme-id');

    // Find a non-active theme info to click (pick the first non-active one)
    const nonActiveInfo = page.locator('.theme-manager-item:not(.active) .theme-manager-info').first();
    await nonActiveInfo.click();

    // Wait for the theme to switch -- the active item should change
    await page.waitForFunction(
      (prevId) => {
        const el = document.querySelector('.theme-manager-item.active');
        return el !== null && el.getAttribute('data-theme-id') !== prevId;
      },
      activeId,
      { timeout: 5000 }
    );

    // Verify CSS variable changed (theme switched)
    const newActiveItem = page.locator('.theme-manager-item.active');
    const newActiveId = await newActiveItem.getAttribute('data-theme-id');
    expect(newActiveId).not.toBe(activeId);
  });

  test('active theme has selected style in theme manager', async ({ page }) => {
    await page.goto('/');
    const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]');
    await settingsBtn.first().click();
    await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-tab="general"]').click();
    await page.locator('#manage-themes-btn').click();
    await expect(page.locator('.theme-manager-dialog')).toBeVisible({ timeout: 5000 });

    // Exactly one item should have the .active class
    const activeItems = page.locator('.theme-manager-item.active');
    await expect(activeItems).toHaveCount(1);
  });

  test('duplicate a theme creates a new entry', async ({ page }) => {
    await page.goto('/');
    const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]');
    await settingsBtn.first().click();
    await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-tab="general"]').click();
    await page.locator('#manage-themes-btn').click();
    await expect(page.locator('.theme-manager-dialog')).toBeVisible({ timeout: 5000 });

    // Count initial theme items
    const initialCount = await page.locator('.theme-manager-item').count();

    // Click the "..." menu on the first theme
    const firstMenuBtn = page.locator('.tm-menu-btn').first();
    await firstMenuBtn.click();

    // Wait for context menu to appear
    await expect(page.locator('.tm-context-menu')).toBeVisible({ timeout: 3000 });

    // Click "Duplicate"
    const duplicateItem = page.locator('.tm-menu-item', { hasText: 'Duplicate' });
    await duplicateItem.click();

    // Wait for the list to refresh with an additional item
    await page.waitForFunction(
      (prev) => document.querySelectorAll('.theme-manager-item').length > prev,
      initialCount,
      { timeout: 5000 }
    );

    const newCount = await page.locator('.theme-manager-item').count();
    expect(newCount).toBe(initialCount + 1);

    // The new item should appear under "User Themes" section
    await expect(page.locator('.theme-manager-section-label', { hasText: 'User Themes' })).toBeVisible();
  });

  test('delete a custom theme removes it from the list', async ({ page }) => {
    await page.goto('/');
    const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]');
    await settingsBtn.first().click();
    await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-tab="general"]').click();
    await page.locator('#manage-themes-btn').click();
    await expect(page.locator('.theme-manager-dialog')).toBeVisible({ timeout: 5000 });

    // First, duplicate a theme to create a custom one we can delete
    const firstMenuBtn = page.locator('.tm-menu-btn').first();
    await firstMenuBtn.click();
    await expect(page.locator('.tm-context-menu')).toBeVisible({ timeout: 3000 });
    await page.locator('.tm-menu-item', { hasText: 'Duplicate' }).click();

    // Wait for the User Themes section to appear and list to stabilize
    await expect(page.locator('.theme-manager-section-label', { hasText: 'User Themes' })).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500); // Wait for render to stabilize

    // Count items after duplication
    const countAfterDup = await page.locator('.theme-manager-item').count();

    // Find the last theme item (the custom copy we just created)
    const customItem = page.locator('.theme-manager-item').last();
    await expect(customItem).toBeVisible();

    // Open its context menu
    await customItem.locator('.tm-menu-btn').click();
    await expect(page.locator('.tm-context-menu')).toBeVisible({ timeout: 3000 });

    // Click Delete in context menu
    await page.locator('.tm-menu-item', { hasText: 'Delete' }).click();

    // Confirm in the delete confirmation modal
    await expect(page.locator('#del-confirm')).toBeVisible({ timeout: 3000 });
    await page.locator('#del-confirm').click();

    // Wait for item count to decrease
    await expect(page.locator('.theme-manager-item')).toHaveCount(countAfterDup - 1, { timeout: 5000 });
  });

  test('closing theme manager with Escape', async ({ page }) => {
    await page.goto('/');
    const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]');
    await settingsBtn.first().click();
    await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-tab="general"]').click();
    await page.locator('#manage-themes-btn').click();
    await expect(page.locator('.theme-manager-dialog')).toBeVisible({ timeout: 5000 });

    // Press Escape to close the theme manager
    await page.keyboard.press('Escape');
    await expect(page.locator('.theme-manager-dialog')).not.toBeVisible({ timeout: 3000 });
  });
});
