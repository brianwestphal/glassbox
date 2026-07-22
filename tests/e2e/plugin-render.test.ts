import { test, expect } from './coverage-fixture.js';

/**
 * Browser-driven coverage for the content-plugin **file-diff render path**
 * (doc 29 FR-29.2 / FR-29.9, GB-1042 / GB-1052) with a REAL installed plugin.
 *
 * The unit suite covers the registry, dispatch, loader, and `fileView` render in
 * isolation; what only an in-browser test catches is the full wiring — an
 * installed plugin is discovered at startup, `/files` flags the file it handles
 * as `pluginRendered`, the client shows the Code|Rendered toggle, and flipping to
 * Rendered routes the plugin's SVG through the image viewer (served as
 * `image/svg+xml` by the image route). Previously verified only by hand.
 *
 * Playwright boots a dedicated `--diff` server on port 4186 against a checked-in
 * `.fdiag` pair, with the `fixture-diagram` plugin (`tests/fixtures/plugin/`)
 * pre-installed in an isolated `GLASSBOX_CONFIG_DIR` (see `playwright.config.ts`).
 * The fixture plugin renders any `.fdiag` file to a fixed inert SVG.
 */

test.describe.configure({ mode: 'serial' });

test.describe('content-plugin file-diff render path (doc 29, GB-1043)', () => {
  test('a plugin-handled file shows the Code|Rendered toggle; Code is the text diff', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    await page.locator('.file-item .file-name', { hasText: 'diagram.fdiag' }).click();

    // The installed fixture plugin handles `.fdiag`, so `/files` flags the file
    // as pluginRendered and the client shows the SVG-style Code|Rendered toggle
    // (GB-1052) — a file no plugin handled would never surface this control.
    await expect(page.locator('.diff-toolbar-svg-toggle')).toBeVisible({ timeout: 5000 });

    // Force the Code view (the SVG view mode is a persisted preference, so a prior
    // test that flipped to Rendered would otherwise carry over).
    await page.locator('[data-svg-mode="code"]').click();

    // Code is the ordinary text diff of the source: the new side added `c -> d` /
    // `d -> a`, which must render as added lines.
    await expect(page.locator('.diff-line.add').filter({ hasText: 'c -> d' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.diff-line.add').filter({ hasText: 'd -> a' })).toBeVisible();
  });

  test('Rendered view mounts the image viewer with both sides as plugin-rendered SVG', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-item .file-name', { hasText: 'diagram.fdiag' }).click();

    // Flip to Rendered → the image-comparison panel mounts (as it does for an SVG
    // file), sized to the plugin's per-side SVG.
    await page.locator('[data-svg-mode="rendered"]').click();

    const imageDiff = page.locator('.image-diff');
    await expect(imageDiff).toBeVisible({ timeout: 5000 });
    await expect(imageDiff).toHaveAttribute('data-has-old', 'true');
    await expect(imageDiff).toHaveAttribute('data-has-new', 'true');

    // Both sides decode: the image route serves the plugin-rendered SVG live, so
    // the browser must successfully load two non-empty images.
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.image-diff .image-layer'));
      return imgs.length >= 2 && imgs.every((img) => img.complete && img.naturalWidth > 0);
    }, null, { timeout: 10000 });

    // The bytes served are this plugin's output: served as `image/svg+xml` and
    // containing the fixture's `fdiag` marker (proves the plugin actually ran, not
    // a built-in SVG passthrough — `.fdiag` is not a natively-recognized image).
    const fileId = await imageDiff.getAttribute('data-file-id');
    const served = await page.evaluate(async (id) => {
      const res = await fetch(`/api/image/${id}/new`);
      return { ct: res.headers.get('Content-Type'), body: await res.text() };
    }, fileId);
    expect(served.ct).toBe('image/svg+xml');
    expect(served.body).toContain('<svg');
    expect(served.body).toContain('fdiag new');
  });

  test('a review-note .fdiag artifact is plugin-rendered as an inline inert SVG (artifact path)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-item .file-name', { hasText: 'diagram.fdiag' }).click();

    // Review notes render in the text-diff (Code) view; force it (the SVG view
    // mode persists across tests).
    await expect(page.locator('.diff-toolbar-svg-toggle')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-svg-mode="code"]').click();

    // The committed `.pr-notes/` note anchored to this file renders in the text-diff
    // view (its body proves it loaded), and its `.fdiag` proof artifact is rendered
    // by the fixture plugin (doc 29 FR-29.2 artifact path, doc 20 §20.5).
    await expect(page.locator('.ai-note-review').filter({ hasText: 'proves the pipeline order' }))
      .toBeVisible({ timeout: 5000 });

    // The rendered artifact is an inline inert SVG data URI (not the raw code
    // block), containing the fixture plugin's `fdiag` marker.
    const artifactImg = page.locator('.ai-note-artifact-img').first();
    await expect(artifactImg).toBeVisible({ timeout: 5000 });
    const src = await artifactImg.getAttribute('src');
    expect(src ?? '').toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(src ?? '')).toContain('fdiag');
  });
});
