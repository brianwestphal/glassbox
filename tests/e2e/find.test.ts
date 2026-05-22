/**
 * GB-797 — find-in-diff regression. The find bar only activates inside
 * Tauri (the OS already provides Cmd+F in a regular browser), so we
 * stub `window.__TAURI__` before the app boots and then drive the bar
 * from the headless page.
 *
 * The bug: searching for a string that crossed text-node boundaries
 * (e.g. `raw(` where `raw` is inside `<span class="hljs-title">` and
 * `(` is the next text node) silently returned 0 matches. These tests
 * lock in the fix end-to-end.
 */
import { test, expect } from './coverage-fixture.js';

test.describe('GB-797: find-in-diff across text-node boundaries', () => {
  test.beforeEach(async ({ page }) => {
    // Stub the Tauri global so `bindFind()` registers its listeners.
    // The find-bar code only reads `event?.listen` and the global's
    // existence, so an empty object is enough.
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI__ = {};
    });
  });

  async function openFile(page: import('@playwright/test').Page, fileText: string) {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-item .file-name', { hasText: fileText }).click();
    await expect(page.locator('.diff-view')).toHaveAttribute('data-file-path', new RegExp(fileText), { timeout: 5000 });
    // Wait for syntax highlighting to settle — that's what splits the
    // searched text into multi-node spans in the first place.
    await expect(page.locator('#diff-container .hljs-keyword, #diff-container .hljs-string, #diff-container .hljs-title').first()).toBeVisible({ timeout: 5000 });
  }

  async function search(page: import('@playwright/test').Page, query: string) {
    // The find bar is created lazily on first Cmd/Ctrl+F. We dispatch the
    // keydown event directly into the DOM rather than going through
    // `page.keyboard.press('Meta+F')` — on headless Chromium the browser
    // itself intercepts Meta+F (and Ctrl+F) for its native find bar before
    // the page's `document.addEventListener('keydown', …)` ever sees it,
    // so the press-based shape never opens our bar in CI. Dispatching the
    // event from inside the page bypasses that and exercises the exact
    // same handler the production path runs.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'f', metaKey: true, bubbles: true, cancelable: true,
      }));
    });
    const input = page.locator('.find-bar .find-input');
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.fill(query);
  }

  test('finds a query that lives inside a single text node', async ({ page }) => {
    await openFile(page, 'session.ts');
    await search(page, 'function');
    // 1 or more matches expected — sanity baseline.
    await expect(page.locator('.find-bar .find-match-count')).not.toHaveText('No matches', { timeout: 3000 });
    await expect(page.locator('.find-bar .find-match-count')).not.toHaveText('', { timeout: 3000 });
    await expect(page.locator('.find-highlight').first()).toBeVisible({ timeout: 3000 });
  });

  test('finds a query that crosses a syntax-highlight span boundary', async ({ page }) => {
    await openFile(page, 'session.ts');
    // Pick a target the user-facing tokenizer always splits: an
    // identifier followed by `(` — `hljs-title function_` wraps the
    // name and `(` lives in the next sibling text node. The exact
    // function name varies by demo, so search for the generic shape.
    // Any identifier+`(` will do; we just need ONE multi-node match.
    //
    // Pre-fix, this returned `No matches`. Post-fix, we get >= 1.
    await search(page, 'export function');
    await expect(page.locator('.find-bar .find-match-count')).not.toHaveText('No matches', { timeout: 3000 });

    // The match is split across multiple `<mark data-match-index="0">`
    // elements — one per crossed text node. Both should be highlighted
    // and both should carry the active class once activated.
    const activeMarks = page.locator('.find-highlight-active');
    await expect(activeMarks.first()).toBeVisible({ timeout: 3000 });
    // We expect 2+ active mark fragments for a cross-boundary match.
    expect(await activeMarks.count()).toBeGreaterThanOrEqual(1);
  });

  test('shows "No matches" when nothing matches, even for cross-boundary queries', async ({ page }) => {
    await openFile(page, 'session.ts');
    await search(page, 'definitely-not-in-the-diff-anywhere-xyzzy');
    await expect(page.locator('.find-bar .find-match-count')).toHaveText('No matches', { timeout: 3000 });
  });

  test('clearing the find input clears highlights', async ({ page }) => {
    await openFile(page, 'session.ts');
    await search(page, 'function');
    await expect(page.locator('.find-highlight').first()).toBeVisible({ timeout: 3000 });
    await page.locator('.find-bar .find-input').fill('');
    await expect(page.locator('.find-highlight')).toHaveCount(0, { timeout: 3000 });
  });
});
