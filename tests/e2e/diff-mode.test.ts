import { test, expect } from './coverage-fixture.js';

/**
 * Browser-driven coverage for direct-comparison mode (doc 18).
 *
 * The unit suite covers the diff engine, path normalization, mode round-trip,
 * and disk-read image sides; what only an in-browser test catches is whether
 * the UI actually renders a review whose `repoRoot` isn't a git repository
 * and whose file paths and image bytes flow through the disk-read code paths
 * rather than the git-ref ones — i.e. that the wiring between server and
 * client survives the `--diff` bootstrap end-to-end.
 *
 * Playwright boots a dedicated `npx tsx src/cli.ts --diff tests/fixtures/diff/old
 * tests/fixtures/diff/new …` server on port 4184; this project sets
 * `baseURL` to that port (`playwright.config.ts`).
 */

// State-mutating tests (annotate, complete) must run after the read-only
// rendering checks; serial order keeps that contract explicit.
test.describe.configure({ mode: 'serial' });

test.describe('--diff direct-comparison mode (doc 18)', () => {
  test('file list shows added / deleted / modified files at their relative paths', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    // Folder-vs-folder pairing classifies each side correctly. The sidebar
    // renders a folder tree, so `util.ts` lives under a `sub/` folder header,
    // and its file-name `title` carries the full relative path — the cleanest
    // place to assert the path normalization landed.
    const names = page.locator('.file-item .file-name');
    await expect(names.filter({ hasText: 'added.txt' })).toHaveCount(1);
    await expect(names.filter({ hasText: 'removed.txt' })).toHaveCount(1);
    await expect(names.filter({ hasText: 'icon.svg' })).toHaveCount(1);
    await expect(page.locator('.file-name[title="sub/util.ts"]')).toHaveCount(1);

    // The `dirA/`/`dirB/` prefixes that `git diff --no-index` emits must NOT
    // leak into the folder tree — if they did, the sidebar would show a
    // top-level `new/` or `old/` folder containing `sub/util.ts`.
    await expect(page.locator('.folder-header[data-folder-path="new"]')).toHaveCount(0);
    await expect(page.locator('.folder-header[data-folder-path="old"]')).toHaveCount(0);
    await expect(page.locator('.folder-header[data-folder-path="sub"]')).toHaveCount(1);
  });

  test('opening sub/util.ts renders its diff hunks', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-name[title="sub/util.ts"]').click();

    // The modified line (`b = 2` → `b = 22`) plus the added trailing line
    // (`d = 4`) must both render — proves the diff payload made it from
    // `git diff --no-index` through to the DOM.
    await expect(page.locator('.diff-line.remove').filter({ hasText: 'export const b = 2;' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.diff-line.add').filter({ hasText: 'export const b = 22;' })).toBeVisible();
    await expect(page.locator('.diff-line.add').filter({ hasText: 'export const d = 4;' })).toBeVisible();
  });

  test('SVG file uses the image-diff view with both old/new sides rendered live from disk (GB-932)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-item .file-name', { hasText: 'icon.svg' }).click();
    // SVG defaults to the text-diff "Code" view; flip to "Rendered" so the
    // image-comparison panel mounts.
    await page.locator('[data-svg-mode="rendered"]').click();

    const imageDiff = page.locator('.image-diff');
    await expect(imageDiff).toBeVisible({ timeout: 5000 });
    await expect(imageDiff).toHaveAttribute('data-has-old', 'true');
    await expect(imageDiff).toHaveAttribute('data-has-new', 'true');

    // GB-932: SVGs are served as raw `image/svg+xml` and rendered live by the
    // browser (no server-side rasterization), so animated SVGs animate. The
    // browser must still successfully decode both sides — proves the disk-read
    // path in `getOldImage`/`getNewImage` returns the SVG bytes and the route
    // serves them with a content-type the browser will render.
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.image-diff .image-layer'));
      return imgs.length >= 2 && imgs.every((img) => img.complete && img.naturalWidth > 0);
    }, null, { timeout: 10000 });

    const dims = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.image-diff .image-layer'));
      return imgs.map((img) => ({ src: img.src, w: img.naturalWidth, h: img.naturalHeight }));
    });
    expect(dims.length).toBeGreaterThanOrEqual(2);
    for (const d of dims) {
      expect(d.w, `image ${d.src} should have decoded to a non-zero width`).toBeGreaterThan(0);
      expect(d.h).toBeGreaterThan(0);
    }

    // The image bytes come back as a live SVG document, not a rasterized PNG.
    const fileId = await imageDiff.getAttribute('data-file-id');
    const ct = await page.evaluate(async (id) => {
      const res = await fetch(`/api/image/${id}/new`);
      return res.headers.get('Content-Type');
    }, fileId);
    expect(ct).toBe('image/svg+xml');
  });

  test('clicking a diff line on a direct-comparison file opens the annotation form and saves', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-name[title="sub/util.ts"]').click();
    await page.locator('.diff-line.add').first().click();

    const form = page.locator('.annotation-form');
    await expect(form).toBeVisible({ timeout: 3000 });
    await form.locator('textarea').fill('Looks good — confirming the renamed constant');
    await page.keyboard.press('Control+Enter');

    // After save the row should render; the badge in the sidebar bumps too.
    await expect(page.locator('.annotation-row').filter({ hasText: 'confirming the renamed constant' }))
      .toBeVisible({ timeout: 5000 });
  });

  test('Complete Review opens the completion modal (review can be finalized outside a repo)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    // The completion button must be wired up even when there's no git repo
    // backing the review (doc 18 FR-18.8 — `--diff` runs outside a repo, so the
    // launch-time auto-.gitignore step is skipped; the modal still appears).
    await page.locator('#complete-review').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 10000 });
  });
  // Retained pre-upgrade database backup (doc 9 §9.1a). The section is rendered
  // only when a backup actually exists on disk; `playwright.config.ts` seeds a
  // `reviews.bak-<stamp>` directory into this server's data dir before startup,
  // since a real one can only appear after a PostgreSQL major upgrade that no
  // test can provoke against a fresh install. Runs last: it deletes the backup,
  // so the section is gone for anything after it.
  test('Settings shows the retained database backup and can delete it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    const settingsBtn = page.locator('.settings-btn, [data-settings-btn], button[title*="Settings"]').first();
    await settingsBtn.click();
    await expect(page.locator('.settings-dialog')).toBeVisible({ timeout: 5000 });

    // Two preserved directories are seeded, one of each kind. They must render
    // as separate sections: only the backup may be deleted.
    const backupSection = page.locator('.settings-section').filter({ hasText: 'Database backups' });
    const quarantineSection = page.locator('.settings-section').filter({ hasText: 'Preserved unreadable data' });
    await expect(backupSection).toHaveCount(1);
    await expect(quarantineSection).toHaveCount(1);

    // The quarantined one offers Reveal and NO delete — it may be the user's
    // only copy of data Glassbox could not read.
    await expect(quarantineSection.locator('[data-reveal-backup]')).toHaveCount(1);
    await expect(quarantineSection.locator('[data-delete-backup]')).toHaveCount(0);
    await expect(quarantineSection.locator('.settings-backup-path')).toContainText('reviews.unreadable-');

    const row = backupSection.locator('.settings-backup-row');
    await expect(row).toHaveCount(1);
    // The size is the whole directory, so it must exceed the 4096-byte file the
    // fixture writes — proving the recursive walk ran rather than reporting 0.
    await expect(row.locator('.settings-backup-size')).toHaveText(/\d+(\.\d+)?\s*(KB|MB)/);
    await expect(row.locator('.settings-backup-path')).toContainText('reviews.bak-');
    // A real backup name must parse into a date. The parser originally matched
    // only a hand-written all-hyphen shape, so every real backup rendered the
    // "Saved before a database upgrade" fallback instead.
    await expect(row.locator('.settings-backup-date')).toHaveText(/^Saved \d/);

    // Deleting is confirmed first — the backup is the user's only fallback.
    await row.locator('[data-delete-backup]').click();
    const confirm = page.locator('.modal-overlay').filter({ hasText: 'Delete Database Backup' });
    await expect(confirm).toBeVisible({ timeout: 3000 });

    // Cancelling must leave it in place.
    await confirm.locator('#backup-del-cancel').click();
    await expect(row).toHaveCount(1);

    await row.locator('[data-delete-backup]').click();
    await page.locator('#backup-del-confirm').click();

    // The list is re-read from the server, so an empty result means the
    // directory is really gone — and the whole section stops rendering.
    await expect(backupSection).toHaveCount(0, { timeout: 5000 });
    // The quarantined section is untouched by deleting a backup.
    await expect(quarantineSection).toHaveCount(1);
    await expect(page.locator('.settings-dialog')).toContainText('Git difftool');
  });
});
