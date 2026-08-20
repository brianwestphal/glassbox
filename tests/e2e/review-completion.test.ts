import { test, expect } from './coverage-fixture.js';
import type { Page } from '@playwright/test';

test.describe('Review completion', () => {
  test('Complete Review button is visible', async ({ page }) => {
    await page.goto('/');
    const completeBtn = page.locator('button').filter({ hasText: /complete/i });
    await expect(completeBtn).toBeVisible({ timeout: 5000 });
  });

  test('clicking Complete Review triggers completion flow', async ({ page }) => {
    await page.goto('/');
    // Wait for client JS to bind the click handler
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    const completeBtn = page.locator('#complete-review');
    await expect(completeBtn).toBeVisible();
    await completeBtn.click();
    // The completion flow creates a modal overlay (either stale prompt or "Completing..." then result)
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 10000 });
  });
});

// Stage-machine sequences for the completion modal (GB-1088): the modal is a
// four-stage machine (stale-prompt → completing → done, plus failed) and the
// suite previously only asserted that the overlay appears. Each test restores
// the review to in-progress (Reopen) so the shared demo review stays usable.
test.describe('Completion modal stage machine', () => {
  async function openReview(page: Page): Promise<void> {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
  }

  // Every API URL carries a `?reviewId=` query (see src/api/_runner.ts), so
  // route matching goes by pathname, not by glob.
  const filesUrl = (url: URL) => url.pathname === '/api/files';

  /** Patch /api/files so the client store sees stale annotations. The demo DB
   *  has none (staleness only arises from a review update), and the stale
   *  prompt is driven entirely by the client-side staleCounts. */
  async function seedStaleCounts(page: Page, count: number): Promise<void> {
    await page.route(filesUrl, async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as { files: Array<{ id: string }>; staleCounts: Record<string, number> };
      const firstId = json.files[0]?.id;
      json.staleCounts = firstId !== undefined ? { [firstId]: count } : {};
      await route.fulfill({ response, json });
    });
  }

  const modalTitle = (page: Page) => page.locator('.modal h3');
  // The stale decision is a kerfjs/overlay choice() dialog, not a stage of the
  // completion modal — its title/message/buttons live under `.kerf-choice`.
  const staleTitle = (page: Page) => page.locator('.kerf-choice__title');
  const staleDialog = (page: Page) => page.locator('.kerf-choice');
  const completeBtn = (page: Page) => page.locator('#complete-review');
  const reopenBtn = (page: Page) => page.locator('#reopen-review');

  /** Done-stage → click Done → Reopen → review back in progress. */
  async function closeAndReopen(page: Page): Promise<void> {
    await page.locator('[data-action="modal-done"]').click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible();
    await expect(reopenBtn(page)).toBeVisible();
    await reopenBtn(page).click();
    await expect(completeBtn(page)).toBeVisible();
  }

  test('complete → done → reopen → complete again (repeat cycle)', async ({ page }) => {
    await openReview(page);
    await completeBtn(page).click();
    await expect(modalTitle(page)).toHaveText('Review Completed', { timeout: 10000 });
    // The done stage shows the export path and the AI command as copyables.
    await expect(page.locator('.modal-copyable')).toHaveCount(2);

    await closeAndReopen(page);

    // The machine must support a second full cycle after reopen.
    await completeBtn(page).click();
    await expect(modalTitle(page)).toHaveText('Review Completed', { timeout: 10000 });
    await closeAndReopen(page);
  });

  test('stale-prompt: cancel → fresh prompt → discard-all → done → reopen → no stale prompt', async ({ page }) => {
    await seedStaleCounts(page, 2);
    await openReview(page);

    await completeBtn(page).click();
    await expect(staleTitle(page)).toHaveText('Stale Annotations');
    await expect(staleDialog(page)).toContainText('are 2 stale annotations');

    // Cancel: the choice dialog closes and the review is NOT completed.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(staleDialog(page)).not.toBeVisible();
    await expect(completeBtn(page)).toBeVisible();
    await expect(reopenBtn(page)).not.toBeVisible();

    // Reopening the modal starts from a fresh stale prompt, not a stale stage.
    await completeBtn(page).click();
    await expect(staleTitle(page)).toHaveText('Stale Annotations');

    // Discard all → the delete-all API fires → completion proceeds to done.
    const discardReq = page.waitForRequest(
      (r) => r.url().includes('/api/annotations/stale/delete-all') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Discard All Stale' }).click();
    await discardReq;
    await expect(modalTitle(page)).toHaveText('Review Completed', { timeout: 10000 });

    await closeAndReopen(page);

    // The discard cleared the client's stale counts: completing again goes
    // straight past the stale prompt.
    await completeBtn(page).click();
    await expect(modalTitle(page)).toHaveText('Review Completed', { timeout: 10000 });
    await closeAndReopen(page);
    await page.unroute(filesUrl);
  });

  test('stale-prompt: keep-all completes without deleting (singular message)', async ({ page }) => {
    await seedStaleCounts(page, 1);
    await openReview(page);
    const annotationTotal = await page.evaluate(async () => {
      const res = await fetch('/api/annotations/all');
      return ((await res.json()) as unknown[]).length;
    });

    await completeBtn(page).click();
    await expect(staleTitle(page)).toHaveText('Stale Annotations');
    await expect(staleDialog(page)).toContainText('is 1 stale annotation');

    const keepReq = page.waitForRequest(
      (r) => r.url().includes('/api/annotations/stale/keep-all') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Keep All & Complete' }).click();
    await keepReq;
    await expect(modalTitle(page)).toHaveText('Review Completed', { timeout: 10000 });

    // Keep-all preserves annotations (vs discard, which deletes stale ones).
    const afterTotal = await page.evaluate(async () => {
      const res = await fetch('/api/annotations/all');
      return ((await res.json()) as unknown[]).length;
    });
    expect(afterTotal).toBe(annotationTotal);

    await closeAndReopen(page);
    await page.unroute(filesUrl);
  });

  // The failed stage lives in its own describe so the deliberate-500
  // allowlist below doesn't weaken the error tracking of the tests above.
  test.describe('failed stage', () => {
    // The deliberate 500 logs a "Failed to load resource" browser console
    // error — allowlist exactly that so any OTHER error still fails the test.
    test.use({ allowedPageErrors: [/Failed to load resource|500|Completing the review failed/] });

    test('a failed complete call surfaces and a retry succeeds (GB-1082)', async ({ page }) => {
      await openReview(page);

      // First attempt: the server errors. The modal must land on the failed
      // stage with an exit button — not sit on "Completing..." forever.
      await page.route(
        (url) => url.pathname === '/api/review/complete',
        (route) => route.fulfill({ status: 500, body: 'boom' }),
        { times: 1 },
      );
      await completeBtn(page).click();
      await expect(modalTitle(page)).toHaveText('Completion Failed', { timeout: 10000 });
      await page.locator('[data-action="modal-done"]').click();
      await expect(page.locator('.modal-overlay')).not.toBeVisible();
      // The review is unchanged — Complete is still the toolbar action.
      await expect(completeBtn(page)).toBeVisible();

      // Retry without the fault: failed → (new modal) → done.
      await completeBtn(page).click();
      await expect(modalTitle(page)).toHaveText('Review Completed', { timeout: 10000 });
      await closeAndReopen(page);
    });
  });
});

test.describe('Review history', () => {
  test('history page shows review entries', async ({ page }) => {
    await page.goto('/history');
    await expect(page.locator('.history-page')).toBeVisible();
    const historyItems = page.locator('.history-item');
    await expect(historyItems.first()).toBeVisible({ timeout: 5000 });
    const count = await historyItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('history entries show repo name and status', async ({ page }) => {
    await page.goto('/history');
    await expect(page.locator('.history-page')).toBeVisible();
    const firstItem = page.locator('.history-item').first();
    await expect(firstItem).toBeVisible({ timeout: 5000 });
    // Each history item has heading with repo info
    await expect(firstItem.locator('h3')).toContainText('demo');
    // Status badge should exist
    await expect(firstItem.locator('.status-badge').first()).toBeVisible();
  });
});
