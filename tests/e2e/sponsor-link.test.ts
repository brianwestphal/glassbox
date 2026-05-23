/**
 * GB-808 — the Sponsor button did nothing in the Tauri desktop app. It was a
 * bare `<a target="_blank">`, and inside the Tauri webview a `_blank`
 * navigation never reaches a real browser, so the click was silently dropped.
 * The fix detects the Tauri shell at click time and routes the URL through the
 * server's `/open-external` endpoint (which opens the OS default browser via
 * `openOS`) instead.
 *
 * Playwright runs in plain Chromium with no Tauri runtime, so we stub
 * `window.__TAURI__` before the app boots to take the desktop path, and
 * intercept the `/api/open-external` POST so the test machine never actually
 * launches a browser. This exercises the real click wiring end-to-end:
 *   - clicking Sponsor under (stubbed) Tauri POSTs the sponsor URL to
 *     `/open-external` and suppresses the dead `_blank` navigation;
 *   - the anchor still carries a real `href` + `target="_blank"` so the plain
 *     browser fallback (no Tauri) keeps working.
 */
import { expect, test } from './coverage-fixture.js';

const SPONSOR_URL = 'https://github.com/sponsors/brianwestphal';

test.describe('GB-808: Sponsor link opens externally under Tauri', () => {
  test('clicking Sponsor POSTs to open-external and does not navigate', async ({ page }) => {
    // Pretend we're inside the Tauri shell (detection only checks existence).
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI__ = {};
    });

    // Intercept the open call so the real server doesn't spawn a browser, and
    // capture what the client sent.
    let captured: unknown = null;
    await page.route('**/api/open-external*', async (route) => {
      captured = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/');
    const sponsor = page.locator('#sponsor-glassbox-btn');
    await expect(sponsor).toBeVisible({ timeout: 5000 });

    // A `_blank` anchor would normally spawn a popup; assert none opens.
    let popupOpened = false;
    page.on('popup', () => { popupOpened = true; });

    await sponsor.click();

    await expect.poll(() => captured, { timeout: 3000 }).toEqual({ url: SPONSOR_URL });
    expect(popupOpened).toBe(false);
    // The webview also stayed on the app page (no in-place navigation away).
    await expect(page.locator('#sponsor-glassbox-btn')).toBeVisible();
  });

  test('Sponsor anchor keeps a real href for the plain-browser fallback', async ({ page }) => {
    // No Tauri stub here: this is the regular browser path, where the anchor's
    // own `target="_blank"` is the correct behavior and must stay intact.
    await page.goto('/');
    const sponsor = page.locator('#sponsor-glassbox-btn');
    await expect(sponsor).toBeVisible({ timeout: 5000 });
    await expect(sponsor).toHaveAttribute('href', SPONSOR_URL);
    await expect(sponsor).toHaveAttribute('target', '_blank');
    await expect(sponsor).toHaveAttribute('rel', /noopener/);
  });
});
