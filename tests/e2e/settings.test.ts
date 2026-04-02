import { test, expect } from './coverage-fixture.js';

/** Helper to open the settings dialog */
async function openSettings(page: import('@playwright/test').Page) {
  const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]').first();
  await settingsBtn.click();
  await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });
}

test.describe('Tab switching', () => {
  test('General tab is active by default', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    // General tab should be active
    await expect(page.locator('[data-tab="general"]')).toHaveClass(/active/);
    await expect(page.locator('[data-panel="general"]')).toHaveClass(/active/);
  });

  test('switching to Profile tab shows its panel', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    await page.locator('[data-tab="profile"]').click();
    await expect(page.locator('[data-tab="profile"]')).toHaveClass(/active/);
    await expect(page.locator('[data-panel="profile"]')).toHaveClass(/active/);

    // General panel should no longer be active
    await expect(page.locator('[data-panel="general"]')).not.toHaveClass(/active/);
  });

  test('switching to Experimental tab shows its panel', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    await page.locator('[data-tab="experimental"]').click();
    await expect(page.locator('[data-tab="experimental"]')).toHaveClass(/active/);
    await expect(page.locator('[data-panel="experimental"]')).toHaveClass(/active/);

    // General panel should no longer be active
    await expect(page.locator('[data-panel="general"]')).not.toHaveClass(/active/);
  });
});

test.describe('General tab', () => {
  test('theme dropdown and Manage Themes button are visible', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    await expect(page.locator('#settings-theme')).toBeVisible();
    await expect(page.locator('#manage-themes-btn')).toBeVisible();
  });
});

test.describe('Profile tab', () => {
  test('shows experience topic tags', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    await page.locator('[data-tab="profile"]').click();
    await expect(page.locator('[data-panel="profile"]')).toHaveClass(/active/);

    // "I'm new to..." label should exist
    await expect(page.locator('[data-panel="profile"]')).toContainText("I'm new to");

    // Topic tags should exist
    const tags = page.locator('[data-panel="profile"] .settings-tag');
    const count = await tags.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking a topic tag toggles its active class', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    await page.locator('[data-tab="profile"]').click();

    // Find the "Programming" tag
    const programmingTag = page.locator('.settings-tag[data-topic="programming"]');
    await expect(programmingTag).toBeVisible();

    const wasActive = await programmingTag.evaluate(el => el.classList.contains('active'));

    // Click to toggle
    await programmingTag.click();
    // The dialog re-renders on tag click, so re-query
    await page.waitForTimeout(100);

    const programmingTagAfter = page.locator('.settings-tag[data-topic="programming"]');
    if (wasActive) {
      await expect(programmingTagAfter).not.toHaveClass(/\bactive\b/);
    } else {
      await expect(programmingTagAfter).toHaveClass(/active/);
    }
  });

  test('language tags exist (JavaScript, Python, TypeScript, etc.)', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    await page.locator('[data-tab="profile"]').click();

    await expect(page.locator('.settings-tag[data-topic="javascript"]')).toBeVisible();
    await expect(page.locator('.settings-tag[data-topic="python"]')).toBeVisible();
    await expect(page.locator('.settings-tag[data-topic="typescript"]')).toBeVisible();
  });

  test('More languages button reveals additional language tags', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    await page.locator('[data-tab="profile"]').click();

    const moreBtn = page.locator('#show-more-langs');
    await expect(moreBtn).toBeVisible();

    // Additional language tags should not be visible yet
    await expect(page.locator('.settings-tag[data-topic="ruby"]')).not.toBeVisible();

    // Click "More languages..."
    await moreBtn.click();
    await page.waitForTimeout(100);

    // Now additional languages should appear
    await expect(page.locator('.settings-tag[data-topic="ruby"]')).toBeVisible();
    await expect(page.locator('.settings-tag[data-topic="kotlin"]')).toBeVisible();
    await expect(page.locator('.settings-tag[data-topic="haskell"]')).toBeVisible();
  });
});

test.describe('Experimental tab', () => {
  test('platform control, model dropdown, and API key section exist', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    await page.locator('[data-tab="experimental"]').click();
    await expect(page.locator('[data-panel="experimental"]')).toHaveClass(/active/);

    // Platform segmented control
    await expect(page.locator('.settings-platform-control')).toBeVisible();

    // Model dropdown
    await expect(page.locator('#settings-model')).toBeVisible();

    // API key section (either configured status or input)
    await expect(page.locator('.settings-key-status')).toBeVisible();
  });

  test('guided review checkbox exists', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    await page.locator('[data-tab="experimental"]').click();

    await expect(page.locator('#settings-guided-enabled')).toBeVisible();
  });
});

test.describe('Close dialog', () => {
  test('close button removes the dialog', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    await page.locator('#settings-close').click();
    await expect(page.locator('.settings-dialog')).not.toBeVisible({ timeout: 3000 });
  });

  test('Escape key removes the dialog', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-dialog')).not.toBeVisible({ timeout: 3000 });
  });

  test('clicking the overlay removes the dialog', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    // Click the overlay (the parent of .settings-dialog)
    const overlay = page.locator('.modal-overlay');
    // Click at the edge of the overlay (outside the dialog)
    await overlay.click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.settings-dialog')).not.toBeVisible({ timeout: 3000 });
  });

  test('reopen after close works', async ({ page }) => {
    await page.goto('/');

    // Open and close via Escape
    await openSettings(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-dialog')).not.toBeVisible({ timeout: 3000 });

    // Reopen
    await openSettings(page);
    await expect(page.locator('.settings-dialog')).toBeVisible();
  });
});
