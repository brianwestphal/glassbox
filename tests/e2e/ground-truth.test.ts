import { test, expect } from './coverage-fixture.js';

/**
 * Browser-driven coverage for ground-truth comparison mode (doc 26 P1).
 *
 * The unit suite covers the manifest loader, the mode round-trip, the synthetic
 * file diffs, and the expected→old / actual→new image reads. What only an
 * in-browser test catches is whether the UI renders a no-git-repo review whose
 * entries are manifest-driven image pairs — i.e. that the `--ground-truth`
 * bootstrap wires server to client end-to-end and the existing image-comparison
 * view (doc 24) lights up against the expected/actual bytes.
 *
 * Playwright boots a dedicated `npx tsx src/cli.ts --ground-truth
 * tests/fixtures/ground-truth/manifest.json …` server on port 4185; this project
 * sets `baseURL` to that port (`playwright.config.ts`).
 */

// State-mutating tests (annotate, complete) run after the read-only checks.
test.describe.configure({ mode: 'serial' });

test.describe('--ground-truth comparison mode (doc 26 P1)', () => {
  test('source list shows one entry per manifest comparison', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    // Each actual path keys one comparison row (flat named list, doc 26 §26.1);
    // the row's title still carries the raw key for stable selection.
    await expect(page.locator('.file-name[title="actual/button.svg"]')).toHaveCount(1);
    await expect(page.locator('.file-name[title="actual/card.svg"]')).toHaveCount(1);
  });

  // GB-965 (doc 26 §26.1) — source list reads as named comparisons.
  test('source list shows the manifest label and an expectedKind badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    // The row text is the manifest label, not the raw `button.svg` basename.
    const buttonRow = page.locator('.file-item.gt-comparison', { has: page.locator('.file-name[title="actual/button.svg"]') });
    await expect(buttonRow.locator('.file-name')).toHaveText('Submit button');
    await expect(buttonRow.locator('.gt-kind')).toHaveText('Spec');

    // `previous-actual` surfaces as the "Baseline" badge.
    const cardRow = page.locator('.file-item.gt-comparison', { has: page.locator('.file-name[title="actual/card.svg"]') });
    await expect(cardRow.locator('.file-name')).toHaveText('Profile card');
    await expect(cardRow.locator('.gt-kind')).toHaveText('Baseline');
  });

  test('a comparison renders the image-diff view with expected as old (A) and actual as new (B)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-name[title="actual/button.svg"]').click();

    // Manifest entries are binary image pairs, so the image-comparison view
    // (doc 24) mounts directly — no Code/Rendered toggle.
    const imageDiff = page.locator('.image-diff');
    await expect(imageDiff).toBeVisible({ timeout: 5000 });
    await expect(imageDiff).toHaveAttribute('data-has-old', 'true');
    await expect(imageDiff).toHaveAttribute('data-has-new', 'true');

    // Both sides decode from disk (served as raw image/svg+xml, GB-932 path).
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.image-diff .image-layer'));
      return imgs.length >= 2 && imgs.every((img) => img.complete && img.naturalWidth > 0);
    }, null, { timeout: 10000 });

    // Confirm the side mapping: the old (A) bytes are the *expected* spec
    // (fill #3b82f6) and the new (B) bytes are the *actual* (fill #2563eb).
    const fileId = await imageDiff.getAttribute('data-file-id');
    const sides = await page.evaluate(async (id) => {
      const [oldRes, newRes] = await Promise.all([
        fetch(`/api/image/${id}/old`),
        fetch(`/api/image/${id}/new`),
      ]);
      return {
        oldType: oldRes.headers.get('Content-Type'),
        oldBody: await oldRes.text(),
        newBody: await newRes.text(),
      };
    }, fileId);
    expect(sides.oldType).toBe('image/svg+xml');
    expect(sides.oldBody).toContain('#3b82f6'); // expected/button.svg
    expect(sides.newBody).toContain('#2563eb'); // actual/button.svg

    // GB-965 (doc 26 §26.1): the side-by-side captions read Expected/Actual,
    // not the generic Old/New, in ground-truth mode.
    await expect(page.locator('.image-sxs-label').nth(0)).toHaveText('Expected (A)');
    await expect(page.locator('.image-sxs-label').nth(1)).toHaveText('Actual (B)');
  });

  test('an image comment can be added on a ground-truth comparison (no git repo)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-name[title="actual/card.svg"]').click();
    await expect(page.locator('.image-diff')).toBeVisible({ timeout: 5000 });

    // The image-feedback panel (doc 23) offers a general comment box; adding one
    // proves annotations persist for a manifest-driven, repo-less review.
    const commentInput = page.locator('[data-image-feedback] [data-role="general-input"]');
    await expect(commentInput).toBeVisible({ timeout: 5000 });
    await commentInput.fill('The avatar green is a touch too saturated vs the spec');
    await commentInput.press('Control+Enter');
    await expect(page.locator('[data-image-feedback]'))
      .toContainText('too saturated vs the spec', { timeout: 5000 });
  });

  // GB-961 (doc 26 P2) — perceptual difference score.
  test('a scored PNG comparison shows a difference badge in the sidebar and header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    // widget.png differs from its expected by ~25% of pixels (a red stripe over
    // 1/4 of a blue field). The sidebar row carries a difference badge.
    const row = page.locator('.file-item', { has: page.locator('.file-name[title="actual/widget.png"]') });
    await expect(row.locator('.diff-badge')).toHaveText('25%');

    // Opening it surfaces the same score in the diff header.
    await page.locator('.file-name[title="actual/widget.png"]').click();
    await expect(page.locator('.diff-score-badge')).toContainText('25% different', { timeout: 5000 });
  });

  test('identical pairs are hidden by default and revealed by the toggle', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    // logo.png is byte-identical to its expected (0% difference) → hidden.
    await expect(page.locator('.file-name[title="actual/logo.png"]')).toHaveCount(0);

    const toggle = page.locator('.identical-toggle');
    await expect(toggle).toContainText('Show 1 identical');
    await toggle.click();

    // Revealed, and its badge reads 0%.
    await expect(page.locator('.file-name[title="actual/logo.png"]')).toHaveCount(1);
    const row = page.locator('.file-item', { has: page.locator('.file-name[title="actual/logo.png"]') });
    await expect(row.locator('.diff-badge')).toHaveText('0%');
    await expect(toggle).toContainText('Hide 1 identical');
  });

  // GB-968 (doc 26 §26.3 P3b) — version: 2 sets render as named groups with
  // per-step rows, a max-aggregate badge, and a diff-header step navigator.
  test('a version: 2 set renders as a named group with ordered step rows', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    const setGroup = page.locator('.folder-group.gt-set', { has: page.locator('.gt-set-name', { hasText: 'Checkout flow' }) });
    await expect(setGroup).toHaveCount(1);

    // The group header carries the worst-step aggregate (max of 10% / 40%).
    await expect(setGroup.locator('.gt-set-header .diff-badge')).toHaveText('40%');

    // Its step rows are present, in declared order, each with its own score.
    const stepRows = setGroup.locator('.folder-content .file-item.gt-comparison');
    await expect(stepRows).toHaveCount(2);
    await expect(stepRows.nth(0).locator('.file-name')).toHaveText('Cart');
    await expect(stepRows.nth(0).locator('.diff-badge')).toHaveText('10%');
    await expect(stepRows.nth(1).locator('.file-name')).toHaveText('Payment');
    await expect(stepRows.nth(1).locator('.diff-badge')).toHaveText('40%');
  });

  test('the diff header step navigator walks the set bounded to its steps', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    // Open the first step. The header shows "Step 1 of 2" with Prev disabled.
    await page.locator('.file-name[title="set:0/0-1-cart.png"]').click();
    await expect(page.locator('.gt-step-nav .gt-step-label')).toHaveText('Step 1 of 2', { timeout: 5000 });
    const [prev, next] = [page.locator('.gt-step-btn').nth(0), page.locator('.gt-step-btn').nth(1)];
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    // Next advances to step 2; now Next is disabled and Prev enabled.
    await next.click();
    await expect(page.locator('.gt-step-nav .gt-step-label')).toHaveText('Step 2 of 2', { timeout: 5000 });
    await expect(page.locator('.diff-view')).toHaveAttribute('data-file-path', 'set:0/1-2-pay.png');
    await expect(page.locator('.gt-step-btn').nth(0)).toBeEnabled();
    await expect(page.locator('.gt-step-btn').nth(1)).toBeDisabled();

    // Prev returns to step 1.
    await page.locator('.gt-step-btn').nth(0).click();
    await expect(page.locator('.gt-step-nav .gt-step-label')).toHaveText('Step 1 of 2', { timeout: 5000 });
    await expect(page.locator('.diff-view')).toHaveAttribute('data-file-path', 'set:0/0-1-cart.png');
  });

  // GB-966 (doc 24/25) — a side of an image comparison opens full-screen in the
  // shared lightbox (supplementary to the in-place pan/zoom).
  test('the expand button opens a comparison side in the shared lightbox', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-name[title="actual/button.svg"]').click();
    await expect(page.locator('.image-diff')).toBeVisible({ timeout: 5000 });

    const fileId = await page.locator('.image-diff').getAttribute('data-file-id');
    // Open the actual (new / B) side full screen.
    await page.locator('.image-sxs-pane[data-sxs-pane="new"] .image-expand-btn').click();
    const lightbox = page.locator('.lightbox-overlay');
    await expect(lightbox).toBeVisible({ timeout: 5000 });
    await expect(lightbox.locator('.lightbox-img')).toHaveAttribute('src', `/api/image/${fileId}/new`);

    // Esc dismisses it, returning to the diff.
    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
  });

  test('Complete Review opens the completion modal (finalizes outside a repo)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('#complete-review').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 10000 });
  });
});
