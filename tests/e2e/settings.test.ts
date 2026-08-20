import { test, expect } from './coverage-fixture.js';

/** Helper to open the settings dialog */
async function openSettings(page: import('@playwright/test').Page) {
  const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]').first();
  await settingsBtn.click();
  await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });
  // Render-first (GB-1129) shows a spinner shell first, then the tabbed content
  // once data loads — wait for the content so callers can interact immediately.
  await expect(page.locator('[data-tab="general"]')).toBeVisible({ timeout: 5000 });
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

  test('Claude Channel shows a live connected/disconnected status when enabled (doc 17.3)', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);
    await page.locator('[data-tab="experimental"]').click();
    await expect(page.locator('[data-panel="experimental"]')).toHaveClass(/active/);

    const toggle = page.locator('#settings-channel-enabled');
    await expect(toggle).toBeVisible();

    // No status indicator until the channel is enabled.
    await expect(page.locator('#channel-status')).toHaveCount(0);

    await toggle.check();
    // The indicator appears immediately on toggle; with no Claude session
    // listening in CI it reports the disconnected state.
    const status = page.locator('#channel-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveClass(/is-disconnected/);

    // Restore the disabled state so this doesn't leak into the shared demo server.
    await toggle.uncheck();
    await expect(page.locator('#channel-status')).toHaveCount(0);
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

    // A Local fallback exposes the server-URL input (parity with primary-local;
    // GB-926) plus its model select.
    await fallbackPlatform.selectOption('local');
    await expect(page.locator('#settings-local-endpoint')).toBeVisible();
    await expect(page.locator('#settings-fallback-model')).toBeVisible();

    // Pick a cloud fallback platform → URL input goes away; model select + key
    // block render.
    await fallbackPlatform.selectOption('anthropic');
    await expect(page.locator('#settings-local-endpoint')).toHaveCount(0);
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

// GB-1129: opening the dialog must be instant — the modal + a spinner appear
// immediately, and the tabbed content replaces the spinner once the (up to ~1s)
// data fetch resolves. The dialog must never block on that fetch.
test.describe('Render-first (no blocking on data)', () => {
  test('shows the modal + spinner immediately, then swaps in the content', async ({ page }) => {
    // Hold one of the dialog's endpoints open so the data Promise.all is still
    // pending while we assert the shell is already on screen.
    let release: (() => void) | null = null;
    await page.route((url) => url.pathname === '/api/channel/claude-check', async (route) => {
      await new Promise<void>((r) => { release = r; });
      await route.fulfill({ json: { installed: false, version: null, meetsMinimum: false } });
    });

    await page.goto('/');
    await page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]').first().click();

    // Modal + spinner are visible before the held endpoint resolves.
    await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 1000 });
    await expect(page.locator('.settings-loading')).toBeVisible({ timeout: 1000 });
    await expect(page.locator('[data-tab="general"]')).toHaveCount(0);

    // Let the data finish loading; the spinner is replaced by the tabbed content.
    release?.();
    await expect(page.locator('[data-tab="general"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.settings-loading')).toHaveCount(0);

    await page.unroute((url) => url.pathname === '/api/channel/claude-check');
  });

  test('can be dismissed with Escape while still loading', async ({ page }) => {
    await page.route((url) => url.pathname === '/api/channel/claude-check', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ json: { installed: false, version: null, meetsMinimum: false } });
    });

    await page.goto('/');
    await page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]').first().click();
    await expect(page.locator('.settings-loading')).toBeVisible({ timeout: 1000 });

    // Escape during loading closes the dialog and it does not reappear when the
    // held endpoint later resolves.
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-dialog')).not.toBeVisible({ timeout: 1000 });
    await page.waitForTimeout(1800);
    await expect(page.locator('.settings-dialog')).not.toBeVisible();

    await page.unroute((url) => url.pathname === '/api/channel/claude-check');
  });

  // GB-1131: the first open per session may spin while loading, but the data is
  // cached, so a repeat open renders instantly with no spinner. Here the data
  // endpoints are held OPEN on every call — the second open must still show
  // content immediately (it can only do so from cache, not a live fetch).
  test('a repeat open renders instantly from cache (no spinner)', async ({ page }) => {
    const btn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]').first();

    // First (cold) open: normal load, then close so the cache is populated.
    await page.goto('/');
    await btn.click();
    await expect(page.locator('[data-tab="general"]')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-dialog')).not.toBeVisible({ timeout: 3000 });

    // Now stall every settings endpoint. A live fetch would hang; a cached open
    // does not touch the network for its initial render.
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });

    // Second open: content is present within a tight budget, and the spinner
    // never shows — proof it came from cache, not the (now-stalled) fetch.
    await btn.click();
    await expect(page.locator('[data-tab="general"]')).toBeVisible({ timeout: 1000 });
    await expect(page.locator('.settings-loading')).toHaveCount(0);

    await page.unroute((url) => url.pathname.startsWith('/api/'));
  });
});

// GB-1130: the dialog is pinned to the tallest tab's height, so switching tabs
// never resizes it (shorter tabs get empty space at the bottom).
test.describe('Stable height across tabs', () => {
  test('dialog height does not change when switching tabs', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);
    const dialog = page.locator('.settings-dialog');

    const tabIds: string[] = [...new Set(
      await page.locator('[data-tab]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab') ?? '')),
    )].filter((t) => t !== '');
    expect(tabIds.length).toBeGreaterThan(1);

    const heights: number[] = [];
    for (const t of tabIds) {
      await page.locator(`[data-tab="${t}"]`).click();
      await expect(page.locator(`[data-tab="${t}"]`)).toHaveClass(/active/);
      heights.push((await dialog.boundingBox())?.height ?? 0);
    }
    // Every tab yields the same dialog height (within sub-pixel rounding).
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
  });
});
