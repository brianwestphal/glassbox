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

  test('selecting the Local platform reveals the server URL input and an optional key', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);
    await page.locator('[data-tab="experimental"]').click();
    await expect(page.locator('[data-panel="experimental"]')).toHaveClass(/active/);

    // The Local platform option exists; the server-URL input is hidden until selected.
    const localBtn = page.locator('.settings-platform-control [data-platform="local"]');
    await expect(localBtn).toBeVisible();
    await expect(page.locator('#settings-local-endpoint')).toHaveCount(0);

    await localBtn.click();
    await expect(localBtn).toHaveClass(/active/);

    // Server URL input appears, defaulted to the Ollama endpoint.
    const endpoint = page.locator('#settings-local-endpoint');
    await expect(endpoint).toBeVisible();
    await expect(endpoint).toHaveValue('http://localhost:11434/v1');

    // Model dropdown is still present, and the key is framed as optional.
    await expect(page.locator('#settings-model')).toBeVisible();
    await expect(page.getByText('API Key (optional)')).toBeVisible();

    // Reset to the default platform. The demo server's config is isolated to a
    // disposable dir (GB-923), so this no longer protects the developer's real
    // config — it keeps a retry / later test starting from the clean default.
    await page.locator('.settings-platform-control [data-platform="anthropic"]').click();
    await expect(page.locator('#settings-local-endpoint')).toHaveCount(0);
  });

  test('selecting Apple reveals the fallback model picker, which persists', async ({ page }) => {
    // Apple is on-device only; the server forces `appleAvailable` under
    // `--ai-service-test` (the helper can't run on CI/Linux) so this UI is
    // reachable. Its small context window is handled by a secondary fallback
    // model the user picks here.
    await page.goto('/');
    await openSettings(page);
    await page.locator('[data-tab="experimental"]').click();
    await expect(page.locator('[data-panel="experimental"]')).toHaveClass(/active/);

    const appleBtn = page.locator('.settings-platform-control [data-platform="apple"]');
    await expect(appleBtn).toBeVisible();

    // No fallback picker until Apple is selected.
    await expect(page.locator('#settings-fallback-platform')).toHaveCount(0);

    await appleBtn.click();
    await expect(appleBtn).toHaveClass(/active/);

    // The fallback platform select appears, defaulting to "None" (no fallback
    // configured yet), so the fallback model select is hidden.
    const fallbackPlatform = page.locator('#settings-fallback-platform');
    await expect(fallbackPlatform).toBeVisible();
    await expect(page.getByText('Fallback model')).toBeVisible();
    await expect(page.locator('#settings-fallback-model')).toHaveCount(0);

    // Apple must NOT be an option for its own fallback.
    await expect(fallbackPlatform.locator('option[value="apple"]')).toHaveCount(0);

    // Pick a fallback platform → its model select + key block render.
    await fallbackPlatform.selectOption('anthropic');
    await expect(page.locator('#settings-fallback-model')).toBeVisible();
    await expect(page.locator('[data-panel="experimental"] .settings-key-status')).toBeVisible();

    // The selection persists server-side (the dialog saves on change).
    await expect.poll(async () => {
      const cfg = await page.request.get('/api/ai/config').then(r => r.json());
      return [cfg.platform, cfg.fallbackPlatform];
    }).toEqual(['apple', 'anthropic']);

    // Reopen to confirm the saved selection re-renders.
    await page.locator('#settings-close').click();
    await openSettings(page);
    await page.locator('[data-tab="experimental"]').click();
    await expect(appleBtn).toHaveClass(/active/);
    await expect(page.locator('#settings-fallback-platform')).toHaveValue('anthropic');
    await expect(page.locator('#settings-fallback-model')).toBeVisible();

    // Reset to the default platform (clear the fallback first). The demo config
    // is isolated (GB-923); this is for retry / later-test determinism, not the
    // developer's real config.
    await page.locator('#settings-fallback-platform').selectOption('');
    await expect(page.locator('#settings-fallback-model')).toHaveCount(0);
    await page.locator('.settings-platform-control [data-platform="anthropic"]').click();
    await expect(page.locator('#settings-fallback-platform')).toHaveCount(0);
    await expect.poll(async () => {
      const cfg = await page.request.get('/api/ai/config').then(r => r.json());
      return cfg.platform;
    }).toBe('anthropic');
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
