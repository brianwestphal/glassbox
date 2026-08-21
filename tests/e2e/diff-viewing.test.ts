import { test, expect } from './coverage-fixture.js';
import { waitForStableBox } from './stableBox.js';

// Helper: navigate to the review page and click a file to load its diff
async function openFile(page: import('@playwright/test').Page, fileText?: string) {
  await page.goto('/');
  // Wait for client JS to finish rendering the file list
  await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
  if (fileText) {
    await page.locator('.file-item .file-name', { hasText: fileText }).click();
  } else {
    await page.locator('.file-item').first().click();
  }
  // Wait for diff content to fully load (fetched via API, then rendered into #diff-container)
  await expect(page.locator('.diff-header .file-path')).toBeVisible({ timeout: 5000 });
  // The diff loads async, so the first visible `.diff-view` may briefly belong
  // to an auto-selected initial file before the click-driven fetch resolves.
  if (fileText) {
    await expect(page.locator('.diff-view')).toHaveAttribute('data-file-path', new RegExp(fileText), { timeout: 5000 });
  }
}

// Helper: open a modified file (session.ts has remove+add pairs for char diff testing)
async function openModifiedFile(page: import('@playwright/test').Page) {
  await openFile(page, 'session.ts');
}

test.describe('Diff viewing: Split mode (default)', () => {
  test('split diff table is visible with left and right columns', async ({ page }) => {
    await openModifiedFile(page);

    // Split mode is the default for modified files
    const splitTable = page.locator('.diff-table-split');
    await expect(splitTable).toBeVisible();

    // Verify both columns exist
    await expect(splitTable.locator('.split-col-left').first()).toBeVisible();
    await expect(splitTable.locator('.split-col-right').first()).toBeVisible();
  });

  test('split mode has line numbers in gutter spans', async ({ page }) => {
    await openModifiedFile(page);

    const splitTable = page.locator('.diff-table-split');
    await expect(splitTable).toBeVisible();

    // Gutter spans should have data-line-number attributes with actual numbers
    const gutters = splitTable.locator('.gutter[data-line-number]');
    await expect(gutters.first()).toBeVisible();
    const count = await gutters.count();
    expect(count).toBeGreaterThan(0);

    // At least some gutters should have non-empty line numbers
    let foundNumber = false;
    for (let i = 0; i < Math.min(count, 20); i++) {
      const val = await gutters.nth(i).getAttribute('data-line-number');
      if (val && val !== '') {
        foundNumber = true;
        expect(Number(val)).toBeGreaterThan(0);
        break;
      }
    }
    expect(foundNumber).toBe(true);
  });
});

test.describe('Diff viewing: Unified mode', () => {
  test('switching to unified mode shows unified diff table', async ({ page }) => {
    await openModifiedFile(page);

    // Click unified mode button
    await page.locator('[data-diff-mode="unified"]').click();

    // Unified table should appear
    const unifiedTable = page.locator('.diff-table-unified');
    await expect(unifiedTable).toBeVisible();

    // Split table should no longer be present
    await expect(page.locator('.diff-table-split')).not.toBeVisible();
  });

  test('unified mode has old and new line number gutters', async ({ page }) => {
    await openModifiedFile(page);
    await page.locator('[data-diff-mode="unified"]').click();

    // Wait for unified table to fully render with diff lines
    const unifiedTable = page.locator('.diff-table-unified');
    await expect(unifiedTable.locator('.diff-line').first()).toBeVisible({ timeout: 5000 });

    // Should have gutter-old and gutter-new spans
    await expect(unifiedTable.locator('.gutter-old').first()).toBeVisible();
    await expect(unifiedTable.locator('.gutter-new').first()).toBeVisible();
  });
});

test.describe('Diff viewing: Toggle between modes', () => {
  test('switching back to split from unified restores split diff table', async ({ page }) => {
    await openModifiedFile(page);

    // Start in split mode (default for modified files)
    await expect(page.locator('.diff-table-split')).toBeVisible();

    // Switch to unified
    await page.locator('[data-diff-mode="unified"]').click();
    await expect(page.locator('.diff-table-unified')).toBeVisible();
    await expect(page.locator('.diff-table-split')).not.toBeVisible();

    // Switch back to split
    await page.locator('[data-diff-mode="split"]').click();
    await expect(page.locator('.diff-table-split')).toBeVisible();
    await expect(page.locator('.diff-table-unified')).not.toBeVisible();
  });
});

test.describe('Diff viewing: Line types', () => {
  test('added lines have .diff-line.add class', async ({ page }) => {
    await openModifiedFile(page);

    const addLines = page.locator('.diff-line.add');
    await expect(addLines.first()).toBeVisible();
    const count = await addLines.count();
    expect(count).toBeGreaterThan(0);
  });

  test('removed lines have .diff-line.remove class', async ({ page }) => {
    await openModifiedFile(page);

    const removeLines = page.locator('.diff-line.remove');
    await expect(removeLines.first()).toBeVisible();
    const count = await removeLines.count();
    expect(count).toBeGreaterThan(0);
  });

  test('context lines have .diff-line.context class', async ({ page }) => {
    await openModifiedFile(page);

    const contextLines = page.locator('.diff-line.context');
    await expect(contextLines.first()).toBeVisible();
    const count = await contextLines.count();
    expect(count).toBeGreaterThan(0);
  });

  test('added lines contain added content', async ({ page }) => {
    await openModifiedFile(page);

    // session.ts has "import { redis }" as an added line
    const addLines = page.locator('.diff-line.add .code');
    const count = await addLines.count();
    expect(count).toBeGreaterThan(0);

    // Verify at least one add line has non-empty content
    let foundContent = false;
    for (let i = 0; i < Math.min(count, 10); i++) {
      const text = await addLines.nth(i).textContent();
      if (text && text.trim().length > 0) {
        foundContent = true;
        break;
      }
    }
    expect(foundContent).toBe(true);
  });
});

test.describe('Diff viewing: Character-level diff', () => {
  test('modified lines (remove+add pairs) have char-change highlights', async ({ page }) => {
    // session.ts has remove+add pairs like "expiresAt: number" -> "expiresAt: Date"
    await openModifiedFile(page);

    // char-change spans should exist on paired remove+add lines
    const charChanges = page.locator('.char-change');
    await expect(charChanges.first()).toBeVisible();
    const count = await charChanges.count();
    expect(count).toBeGreaterThan(0);
  });

  test('char-change spans contain the changed text portions', async ({ page }) => {
    await openModifiedFile(page);

    const charChanges = page.locator('.char-change');
    await expect(charChanges.first()).toBeVisible();

    // At least one char-change should have non-empty text
    let foundText = false;
    const count = await charChanges.count();
    for (let i = 0; i < Math.min(count, 10); i++) {
      const text = await charChanges.nth(i).textContent();
      if (text && text.trim().length > 0) {
        foundText = true;
        break;
      }
    }
    expect(foundText).toBe(true);
  });
});

test.describe('Diff viewing: Hunk separators', () => {
  test('hunk separators exist with line range attributes', async ({ page }) => {
    await openModifiedFile(page);

    const separators = page.locator('.hunk-separator').filter({ hasNotText: 'Show remaining lines' });
    await expect(separators.first()).toBeVisible();

    // Verify data attributes for line ranges
    const first = separators.first();
    const oldStart = await first.getAttribute('data-old-start');
    const newStart = await first.getAttribute('data-new-start');
    expect(oldStart).not.toBeNull();
    expect(newStart).not.toBeNull();
  });

  test('hunk separators display @@ line range info', async ({ page }) => {
    await openModifiedFile(page);

    const separators = page.locator('.hunk-separator').filter({ hasNotText: 'Show remaining lines' });
    await expect(separators.first()).toBeVisible();

    // Should display @@ markers with line ranges
    const text = await separators.first().textContent();
    expect(text).toContain('@@');
  });
});

test.describe('Diff viewing: Tail expander', () => {
  test('tail expander exists with "Show remaining lines" text', async ({ page }) => {
    await openModifiedFile(page);

    const tailExpander = page.locator('.hunk-expander-tail');
    await expect(tailExpander.first()).toBeVisible();

    const text = await tailExpander.first().textContent();
    expect(text).toContain('Show remaining lines');
  });

  test('tail expander has data-start attribute', async ({ page }) => {
    await openModifiedFile(page);

    const tailExpander = page.locator('.hunk-expander-tail');
    await expect(tailExpander.first()).toBeVisible();

    const start = await tailExpander.first().getAttribute('data-start');
    expect(start).not.toBeNull();
    expect(Number(start)).toBeGreaterThan(0);
  });
});

test.describe('Diff viewing: File status in diff header', () => {
  test('diff header shows file path', async ({ page }) => {
    await openModifiedFile(page);

    const filePath = page.locator('.diff-header .file-path');
    await expect(filePath).toBeVisible();

    const text = await filePath.textContent();
    expect(text).toContain('session');
  });

  test('diff header shows modified status for modified files', async ({ page }) => {
    await openModifiedFile(page);

    const fileStatus = page.locator('.diff-header .file-status');
    await expect(fileStatus).toBeVisible();
    await expect(fileStatus).toHaveClass(/modified/);
    await expect(fileStatus).toHaveText('modified');
  });

  test('diff header shows added status for new files', async ({ page }) => {
    // redis.ts is an "added" file in demo scenario 4
    await openFile(page, 'redis');

    const fileStatus = page.locator('.diff-header .file-status');
    await expect(fileStatus).toBeVisible();
    await expect(fileStatus).toHaveClass(/added/);
    await expect(fileStatus).toHaveText('added');
  });
});

test.describe('Diff viewing: Toolbar', () => {
  test('toolbar has Split and Unified mode buttons', async ({ page }) => {
    await openModifiedFile(page);

    // Toolbar should be visible once a file is selected
    const toolbar = page.locator('#diff-toolbar');
    await expect(toolbar).toBeVisible();

    const splitBtn = page.locator('[data-diff-mode="split"]');
    const unifiedBtn = page.locator('[data-diff-mode="unified"]');
    await expect(splitBtn).toBeVisible();
    await expect(unifiedBtn).toBeVisible();

    // Split should be active by default
    await expect(splitBtn).toHaveClass(/active/);
  });

  test('toolbar has Wrap button', async ({ page }) => {
    await openModifiedFile(page);

    const wrapBtn = page.locator('#wrap-toggle');
    await expect(wrapBtn).toBeVisible();
    await expect(wrapBtn).toHaveText('Wrap');
  });

  test('toolbar has language button', async ({ page }) => {
    await openModifiedFile(page);

    const langBtn = page.locator('#language-btn');
    await expect(langBtn).toBeVisible();
  });

  test('language picker opens above the button and closes when a language is picked', async ({ page }) => {
    await openModifiedFile(page);

    const langBtn = page.locator('#language-btn');
    await langBtn.click();

    // Picker appears, anchored ABOVE the button (autoReposition { placement: 'top' }).
    const popup = page.locator('.language-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
    const btnBox = await langBtn.boundingBox();
    const popupBox = await popup.boundingBox();
    expect(btnBox).not.toBeNull();
    expect(popupBox).not.toBeNull();
    if (btnBox !== null && popupBox !== null) {
      // Bottom of the popup sits at or above the top of the button.
      expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(btnBox.y + 2);
    }

    // Picking a language dismisses the popup (previously a no-op `close()` left
    // it open). Choose a concrete language so the toolbar label updates.
    await popup.locator('.language-option[data-lang="rust"]').click();
    await expect(popup).toHaveCount(0);
  });

  test('unified button becomes active when clicked', async ({ page }) => {
    await openModifiedFile(page);

    const splitBtn = page.locator('[data-diff-mode="split"]');
    const unifiedBtn = page.locator('[data-diff-mode="unified"]');

    // Initially split is active
    await expect(splitBtn).toHaveClass(/active/);

    // Click unified
    await unifiedBtn.click();
    await expect(unifiedBtn).toHaveClass(/active/);

    // Split should no longer be active
    const splitClass = await splitBtn.getAttribute('class');
    expect(splitClass).not.toContain('active');
  });
});

test.describe('Diff viewing: Added file uses unified layout', () => {
  test('added files render in unified mode by default', async ({ page }) => {
    // Added files (like redis.ts) use UnifiedDiff even in split mode setting
    await openFile(page, 'redis');

    const unifiedTable = page.locator('.diff-table-unified');
    await expect(unifiedTable).toBeVisible();

    // All lines should be add type since it is a new file
    const addLines = page.locator('.diff-line.add');
    const count = await addLines.count();
    expect(count).toBeGreaterThan(0);

    // No remove or context lines expected in a purely added file
    const removeLines = page.locator('.diff-line.remove');
    expect(await removeLines.count()).toBe(0);
  });
});

test.describe('Diff viewing: Unified mode char diff', () => {
  test('unified mode also shows char-change highlights on paired lines', async ({ page }) => {
    await openModifiedFile(page);

    // Switch to unified mode
    await page.locator('[data-diff-mode="unified"]').click();
    await expect(page.locator('.diff-table-unified')).toBeVisible();

    // Char-change spans should still exist in unified view
    const charChanges = page.locator('.char-change');
    await expect(charChanges.first()).toBeVisible();
    const count = await charChanges.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('AI-authored review notes (doc 20 P2)', () => {
  // Demo mode serves illustrative `.pr-notes/` notes for session.ts: three
  // aligned notes plus one whose anchored code changed (rendered stale, P3).
  test('review notes render as distinct AI-authored rows in split mode', async ({ page }) => {
    await openModifiedFile(page);
    const rows = page.locator('.ai-note-row.ai-note-review');
    await expect(rows.first()).toBeVisible({ timeout: 5000 });
    // The notes render after the diff loads + the re-anchor pass; under parallel
    // CPU contention (local default-parallel runs share one demo server) the
    // 4th row can lag the first, so give the count assertion extra headroom.
    await expect(rows).toHaveCount(4, { timeout: 10000 });
    // Per-kind badges + producer attribution.
    await expect(page.locator('.ai-note-label-rationale')).toBeVisible();
    await expect(page.locator('.ai-note-label-risk')).toBeVisible();
    await expect(page.locator('.ai-note-producer').first()).toHaveText('Claude Code');
    // The re-anchored note whose code changed is flagged outdated (P3).
    await expect(page.locator('.ai-note-row.ai-note-stale')).toHaveCount(1, { timeout: 10000 });
    await expect(page.locator('.ai-note-stale-tag')).toHaveText('outdated');
  });

  // A note body is markdown and may carry block structure (doc 20 §20.6,
  // GB-1094). Before the block pass existed these rendered as literal `- `
  // characters on a <br>-joined line.
  test('a note body with block markdown renders real block elements', async ({ page }) => {
    await openModifiedFile(page);
    const proof = page.locator('.ai-note-row.ai-note-review[data-kind="proof"] .ai-note-text');
    await expect(proof).toBeVisible({ timeout: 5000 });

    // The lead paragraph and the list are distinct blocks, not one run of text.
    await expect(proof.locator('p').first()).toContainText('written atomically');
    await expect(proof.locator('ul li')).toHaveCount(2);
    await expect(proof.locator('ul li').first()).toContainText('single round trip');
    // Inline formatting still applies inside a list item.
    await expect(proof.locator('ul li code').first()).toHaveText('SET');
    // The literal marker is gone from the rendered text.
    await expect(proof).not.toContainText('- `SET`');
  });

  // SARIF §3.11.6 embedded link: the body writes `[text](0)`, the reader
  // resolves index 0 against `relatedLocations`, and clicking navigates
  // (doc 20 §20.6, GB-1097).
  test('an embedded link in a note body navigates to the referenced file', async ({ page }) => {
    await openModifiedFile(page);
    const link = page.locator('.ai-note-loclink').first();
    await expect(link).toBeVisible({ timeout: 5000 });
    await expect(link).toHaveText('the Redis client');
    await expect(link).toHaveAttribute('data-loc-file', 'src/db/redis.ts');
    // No href — the delegate navigates, so a stray click can't leave the app.
    await expect(link).not.toHaveAttribute('href', /./);

    await link.click();
    await expect(page.locator('.diff-view')).toHaveAttribute('data-file-path', /redis\.ts/, { timeout: 5000 });
  });

  test('review notes also render in unified mode', async ({ page }) => {
    await openModifiedFile(page);
    await page.locator('[data-diff-mode="unified"]').click();
    await expect(page.locator('.diff-table-unified')).toBeVisible();
    await expect(page.locator('.ai-note-row.ai-note-review').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ai-note-row.ai-note-review')).toHaveCount(4, { timeout: 10000 });
    await expect(page.locator('.ai-note-row.ai-note-stale')).toHaveCount(1, { timeout: 10000 });
  });

  test('Keep dismisses the outdated flag on a stale review note (GB-907)', async ({ page }) => {
    await openModifiedFile(page);
    const staleRow = page.locator('.ai-note-row.ai-note-stale');
    await expect(staleRow).toBeVisible({ timeout: 5000 });

    await staleRow.locator('.ai-note-keep-btn').click();
    // The flag and its actions are gone, but the note itself remains.
    await expect(page.locator('.ai-note-row.ai-note-stale')).toHaveCount(0);
    await expect(page.locator('.ai-note-stale-tag')).toHaveCount(0);
    await expect(page.locator('.ai-note-row.ai-note-review')).toHaveCount(4);
  });

  test('Discard removes an outdated review note (GB-907)', async ({ page }) => {
    await openModifiedFile(page);
    const staleRow = page.locator('.ai-note-row.ai-note-stale');
    await expect(staleRow).toBeVisible({ timeout: 5000 });

    await staleRow.locator('.ai-note-discard-btn').click();
    await expect(page.locator('.ai-note-row.ai-note-stale')).toHaveCount(0);
    await expect(page.locator('.ai-note-row.ai-note-review')).toHaveCount(3);
  });

  test('a review note renders an image artifact served from the artifact route (GB-911)', async ({ page }) => {
    await openModifiedFile(page);
    const img = page.locator('.ai-note-artifact-img');
    await expect(img).toHaveCount(1, { timeout: 5000 });
    await expect(img).toHaveAttribute('src', /\/api\/review-notes\/artifact\?file=assets/);
    // Expand the artifact and confirm the route actually serves the bytes.
    await page.getByText('demo-annotations.png').click();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  });

  // GB-953 — click a note image artifact to open the full-screen lightbox, drag
  // a region, and reply: the reply carries a marked-region thumbnail.
  test('marking a region on a note image artifact carries it into the reply', async ({ page }) => {
    await openModifiedFile(page);
    await page.getByText('demo-annotations.png').click();
    const artImg = page.locator('.ai-note-artifact-img');
    await expect.poll(() => artImg.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    await artImg.click();

    const lb = page.locator('.lightbox-overlay');
    await expect(lb.locator('.lightbox-img')).toBeVisible({ timeout: 5000 });
    const frame = lb.locator('.lightbox-frame');
    await expect.poll(async () => (await frame.boundingBox())?.width ?? 0).toBeGreaterThan(20);
    const box = await frame.boundingBox();
    if (!box) throw new Error('lightbox frame has no box');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65, { steps: 10 });
    await page.mouse.up();

    // The lightbox closes and the note's reply form opens with the region armed.
    await expect(lb).toHaveCount(0, { timeout: 5000 });
    const form = page.locator('.annotation-form-container[data-form-key]');
    await expect(form).toBeVisible({ timeout: 5000 });
    const marker = `note-region-${Date.now().toString(36)}`;
    await form.locator('textarea').fill(marker);
    await form.locator('textarea').press('Control+Enter');

    // The reply renders the artifact with the marked rectangle.
    const reply = page.locator('.annotation-item', { hasText: marker });
    await expect(reply).toBeVisible({ timeout: 5000 });
    await expect(reply.locator('.ai-note-reply-region-box')).toBeVisible();
    await expect(reply.locator('.ai-note-reply-region-img')).toHaveAttribute('src', /demo-annotations\.png/);

    // Cleanup so the shared session doesn't accumulate.
    await reply.locator('[data-action="delete"]').click();
    await expect(page.locator('.annotation-item', { hasText: marker })).toHaveCount(0, { timeout: 5000 });
  });

  // GB-963 — the shared lightbox zooms via its controls (also pans / pinches),
  // so a reviewer can mark a precise region on a large artifact.
  test('the note-artifact lightbox zooms via its controls', async ({ page }) => {
    await openModifiedFile(page);
    await page.getByText('demo-annotations.png').click();
    const artImg = page.locator('.ai-note-artifact-img');
    await expect.poll(() => artImg.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    await artImg.click();

    const lb = page.locator('.lightbox-overlay');
    await expect(lb.locator('.lightbox-img')).toBeVisible({ timeout: 5000 });
    const frame = lb.locator('.lightbox-frame');
    await expect(lb.locator('.lightbox-zoom-level')).toHaveText('100%');
    // At rest, no scale transform.
    expect(await frame.evaluate((el) => getComputedStyle(el).transform)).toBe('none');

    // Zooming in scales the frame and bumps the readout past 100%.
    await lb.locator('[data-zoom="in"]').click();
    await lb.locator('[data-zoom="in"]').click();
    await expect(lb.locator('.lightbox-zoom-level')).not.toHaveText('100%');
    await expect(lb).toHaveClass(/lightbox-zoomed/);
    expect(await frame.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');

    // Reset returns to 100% and clears the transform.
    await lb.locator('[data-zoom="reset"]').click();
    await expect(lb.locator('.lightbox-zoom-level')).toHaveText('100%');
    expect(await frame.evaluate((el) => getComputedStyle(el).transform)).toBe('none');

    await page.keyboard.press('Escape');
    await expect(lb).toHaveCount(0, { timeout: 3000 });
  });

  // GB-959 — drag directly on the inline thumbnail (no lightbox), marking
  // several regions that all ride into one reply.
  test('marking multiple regions inline on a note artifact carries them all into the reply', async ({ page }) => {
    await openModifiedFile(page);
    await page.getByText('demo-annotations.png').click();
    const artImg = page.locator('.ai-note-artifact-img');
    await expect.poll(() => artImg.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    // Let the artifact image's box settle before dragging on it — a mid-reflow box
    // made the first drag land off the image, so no region drew and the reply form
    // never opened (GB-1031).
    await waitForStableBox(artImg);

    const dragOn = async (x0: number, y0: number, x1: number, y1: number) => {
      const box = await artImg.boundingBox();
      if (!box) throw new Error('artifact image has no box');
      await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
      await page.mouse.up();
    };

    // First inline drag opens the reply form (no lightbox) with one region armed.
    // Even after waitForStableBox, a late async layout shift (highlight pass, AI
    // note redraw) can move the image between the box read and the mouse events,
    // landing the drag off-target so nothing draws — or degrading it to a click
    // that opens the lightbox. One re-stabilized retry closes that window
    // without masking real regressions (a broken feature fails both attempts).
    const form = page.locator('.annotation-form-container[data-form-key]');
    await dragOn(0.15, 0.15, 0.4, 0.4);
    await page.waitForTimeout(250);
    if (!(await form.isVisible())) {
      if (await page.locator('.lightbox-overlay').count() > 0) await page.keyboard.press('Escape');
      await expect(page.locator('.lightbox-overlay')).toHaveCount(0);
      await waitForStableBox(artImg);
      await dragOn(0.15, 0.15, 0.4, 0.4);
    }
    await expect(page.locator('.lightbox-overlay')).toHaveCount(0);
    await expect(form).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ai-note-artifact-region-overlay .ai-note-artifact-region-box')).toHaveCount(1);

    // A second inline drag adds another region without reopening the form.
    await dragOn(0.55, 0.55, 0.85, 0.85);
    await expect(page.locator('.ai-note-artifact-region-overlay .ai-note-artifact-region-box')).toHaveCount(2);

    const marker = `inline-regions-${Date.now().toString(36)}`;
    await form.locator('textarea').fill(marker);
    await form.locator('textarea').press('Control+Enter');

    // The reply renders both marked rectangles over the artifact.
    const reply = page.locator('.annotation-item', { hasText: marker });
    await expect(reply).toBeVisible({ timeout: 5000 });
    await expect(reply.locator('.ai-note-reply-region-box')).toHaveCount(2);
    await expect(reply.locator('.ai-note-reply-region-img')).toHaveAttribute('src', /demo-annotations\.png/);

    // Cleanup so the shared session doesn't accumulate.
    await reply.locator('[data-action="delete"]').click();
    await expect(page.locator('.annotation-item', { hasText: marker })).toHaveCount(0, { timeout: 5000 });
  });

  test('a review note renders an attached proof artifact (GB-898)', async ({ page }) => {
    await openModifiedFile(page);
    // The proof note (line 23) attaches a test-output artifact.
    const artifact = page.locator('.ai-note-artifact').first();
    await expect(artifact).toBeVisible({ timeout: 5000 });
    await expect(artifact.locator('summary')).toContainText('session-ttl.test.txt');
    await artifact.locator('summary').click();
    await expect(artifact.locator('.ai-note-artifact-content')).toContainText('2 passed');
  });

  test('a review note body renders markdown (GB-909)', async ({ page }) => {
    await openModifiedFile(page);
    // The rationale note (line 14) uses code spans and bold.
    await expect(page.locator('.ai-note-review code').filter({ hasText: 'createSession' }).first())
      .toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ai-note-review strong').filter({ hasText: 'async' }).first()).toBeVisible();
  });

  test('a reply to a review note renders nested beneath it (GB-908)', async ({ page }) => {
    await openModifiedFile(page);
    // The demo seeds a reply to the line-31 risk note; it renders nested.
    const replies = page.locator('.annotation-row.ai-note-replies');
    await expect(replies.first()).toBeVisible({ timeout: 5000 });
    await expect(replies.locator('.annotation-reply-tag').first()).toBeVisible();
    await expect(replies).toContainText('Confirmed');
  });

  test('a reviewer can reply to an AI note, creating a linked annotation (GB-906)', async ({ page }) => {
    await openModifiedFile(page);
    const replyBtn = page.locator('.ai-note-reply-btn').first();
    await expect(replyBtn).toBeVisible({ timeout: 5000 });
    await replyBtn.click();

    // The create form opens, framed as a reply.
    const form = page.locator('.annotation-form-container');
    await expect(form).toBeVisible();
    await expect(page.locator('.annotation-form-reply')).toBeVisible();

    await form.locator('textarea').fill('I have a follow-up question on this');
    await form.locator('.annotation-save-btn').click();

    // The saved reply renders as an annotation marked as a reply to a note.
    await expect(page.locator('.annotation-item').filter({ hasText: 'I have a follow-up question on this' }))
      .toBeVisible({ timeout: 5000 });
    await expect(page.locator('.annotation-reply-tag').first()).toBeVisible();
  });
});
