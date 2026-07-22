import type { Page } from '@playwright/test';

import { test, expect } from './coverage-fixture.js';

/**
 * Browser-driven coverage for the Settings → Plugins **management tab**
 * (doc 29 GB-1040/1047/1059/1069, doc 30 GB-1058) with a REAL installed plugin.
 * Previously only unit/integration-tested + manual.
 *
 * Runs on the `chromium-plugin` server (port 4187) — the same `--diff` server the
 * render-path e2e uses — where the `fixture-diagram` plugin is installed (it
 * declares a preference, a config-layout Test button + status label, and a
 * diff-toolbar UI element) and a self-contained opt-in `fixture-available` plugin
 * sits in the fixture bundle (`GLASSBOX_BUNDLED_PLUGINS_DIR`) so the
 * Available-to-install flow (GB-1069) can install it.
 *
 * The tests are serial and each mutating one restores state; an afterAll safety
 * net re-enables + cleans up so the sibling render-path suite (same server) is
 * unaffected.
 */

const BASE = 'http://localhost:4187';

test.describe.configure({ mode: 'serial' });

/** Open the settings dialog and switch to the Plugins tab (fresh fetch each time). */
async function openPluginsTab(page: Page): Promise<void> {
  const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]').first();
  await settingsBtn.click();
  await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });
  await page.locator('[data-tab="plugins"]').click();
  await expect(page.locator('[data-tab="plugins"]')).toHaveClass(/active/);
}

test.afterAll(async () => {
  // Restore state for the sibling render-path suite (same server): re-enable
  // fixture-diagram and remove fixture-available if a test left them changed.
  try {
    await fetch(`${BASE}/api/plugins/fixture-diagram/disabled`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'global', disabled: false }),
    });
    await fetch(`${BASE}/api/plugins/fixture-available`, { method: 'DELETE' });
  } catch { /* best-effort */ }
});

test.describe('Settings → Plugins management tab (doc 29/30, GB-1070)', () => {
  test('lists the installed fixture plugin with an active status dot', async ({ page }) => {
    await page.goto('/');
    await openPluginsTab(page);

    const row = page.locator('.plugin-row[data-key="fixture-diagram"]');
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row.locator('.plugin-dot.ok')).toBeVisible();
    await expect(row.locator('.plugin-row-title')).toContainText('Fixture Diagram');
  });

  test('renders + saves a manifest preference (select), persisting across reload', async ({ page }) => {
    await page.goto('/');
    await openPluginsTab(page);

    const sel = (): ReturnType<Page['locator']> => page.locator('[data-plugin-pref-id="fixture-diagram"][data-plugin-pref-key="tint"]');
    await expect(sel()).toBeVisible({ timeout: 5000 });

    // Order-independent: flip to whichever value isn't current (a prior run may
    // have left either). The change auto-saves fire-and-forget, so wait for the
    // save POST to round-trip before asserting.
    const current = await sel().inputValue();
    const next = current === 'green' ? 'blue' : 'green';
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/preferences') && r.request().method() === 'POST'),
      sel().selectOption(next),
    ]);
    await expect(sel()).toHaveValue(next);

    // Persists across a full page reload (a fresh read from stored settings).
    await page.reload();
    await openPluginsTab(page);
    await expect(sel()).toHaveValue(next);
  });

  test('config-layout Test button runs onAction and updates its status label', async ({ page }) => {
    await page.goto('/');
    await openPluginsTab(page);

    // The Rendering group renders a status label + a Test button. (We don't assert
    // the initial "Not tested" text — the config-label override is process-global,
    // so a prior click in the same server run may have already set it.)
    await expect(page.locator('[data-key="label-fixture-status"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-plugin-action="fixture-diagram"][data-plugin-action-id="test"]').click();
    // onAction sets the label via updateConfigLabel; the refreshed list shows it.
    await expect(page.locator('[data-key="label-fixture-status"]')).toContainText('Renderer OK', { timeout: 5000 });
  });

  test('a diff-toolbar UI extension button appears and toasts on click (doc 30)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    // Open the file so the diff toolbar (which hosts the plugin-ui slot) is shown.
    await page.locator('.file-item .file-name', { hasText: 'diagram.fdiag' }).click();

    const btn = page.locator('#plugin-ui-diff-toolbar button[data-plugin-ui-id="fixture-diagram"][data-plugin-ui-action="ping"]');
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();
    await expect(page.locator('.app-toast')).toContainText('Fixture pinged', { timeout: 5000 });
  });

  test('disabling the plugin removes its UI contribution; re-enabling restores it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-item .file-name', { hasText: 'diagram.fdiag' }).click();
    const btn = page.locator('#plugin-ui-diff-toolbar button[data-plugin-ui-action="ping"]');
    await expect(btn).toBeVisible({ timeout: 5000 });

    // Disable globally → the plugin unloads → its diff-toolbar button disappears.
    await openPluginsTab(page);
    await page.locator('[data-plugin-toggle="global"][data-plugin-id="fixture-diagram"]').uncheck();
    await page.keyboard.press('Escape');
    await expect(btn).toHaveCount(0, { timeout: 5000 });

    // Re-enable → the button comes back (slots re-render without a reload).
    await openPluginsTab(page);
    await page.locator('[data-plugin-toggle="global"][data-plugin-id="fixture-diagram"]').check();
    await page.keyboard.press('Escape');
    await expect(page.locator('#plugin-ui-diff-toolbar button[data-plugin-ui-action="ping"]')).toBeVisible({ timeout: 5000 });
  });

  test('Available-to-install lists the opt-in fixture with a self-contained hint', async ({ page }) => {
    await page.goto('/');
    await openPluginsTab(page);

    const avail = page.locator('.plugin-available-row[data-key="fixture-available"]');
    await expect(avail).toBeVisible({ timeout: 5000 });
    // The row carries a description meta + an extensions/status meta; assert the
    // self-contained hint appears somewhere in the row.
    await expect(avail).toContainText('ready to install');
  });

  test('clicking Install on an opt-in plugin installs it (ready) and moves it to installed', async ({ page }) => {
    await page.goto('/');
    await openPluginsTab(page);

    await page.locator('[data-plugin-install-bundled="fixture-available"]').click();
    // A "ready" install toasts and the row leaves the Available section…
    await expect(page.locator('.app-toast')).toContainText('Installed fixture-available', { timeout: 8000 });
    await expect(page.locator('.plugin-available-row[data-key="fixture-available"]')).toHaveCount(0, { timeout: 5000 });
    // …and appears in the installed list, active.
    const installed = page.locator('.plugin-row[data-key="fixture-available"]');
    await expect(installed).toBeVisible({ timeout: 5000 });
    await expect(installed.locator('.plugin-dot.ok')).toBeVisible();
  });

  test('uninstalling a plugin removes it from the installed list', async ({ page }) => {
    await page.goto('/');
    await openPluginsTab(page);

    await expect(page.locator('.plugin-row[data-key="fixture-available"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-plugin-uninstall="fixture-available"]').click();
    await expect(page.locator('.plugin-row[data-key="fixture-available"]')).toHaveCount(0, { timeout: 5000 });
    // A bundled opt-in plugin returns to the Available list after uninstall.
    await expect(page.locator('.plugin-available-row[data-key="fixture-available"]')).toBeVisible({ timeout: 5000 });
  });
});
