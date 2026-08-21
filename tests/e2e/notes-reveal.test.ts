import { expect, test } from './coverage-fixture.js';

// Review-notes reveal on context expansion (doc 20 §20.6, GB-1139). Runs against
// the isolated `--diff` server (port 4188) whose fixture file has a collapsed
// middle with a committed `.pr-notes/` note anchored inside it. Expanding the
// region must surface the note — in BOTH split and unified views.

const NOTE_TEXT = 'note anchored here in a collapsed region';

async function openSample(page: import('@playwright/test').Page, mode: 'split' | 'unified') {
  await page.goto('/');
  await page.locator('.file-item .file-name', { hasText: 'sample.ts' }).first().click();
  await expect(page.locator('.diff-header .file-path')).toBeVisible({ timeout: 5000 });
  await page.locator(`[data-diff-mode="${mode}"]`).first().click();
  await page.waitForTimeout(200);
}

/** Click every mid-hunk expander (the empty-gap one at the top is a no-op). */
async function expandAll(page: import('@playwright/test').Page) {
  const seps = page.locator('.hunk-separator:not(.hunk-expander-tail)');
  const n = await seps.count();
  for (let i = 0; i < n; i++) {
    await seps.nth(i).click({ timeout: 2000 }).catch(() => { /* already spliced away */ });
    await page.waitForTimeout(150);
  }
}

for (const mode of ['unified', 'split'] as const) {
  test(`a review note hidden in a collapsed region is revealed on expand (${mode})`, async ({ page }) => {
    await openSample(page, mode);

    // The note is anchored in the collapsed middle, so it is not shown yet.
    await expect(page.locator('.ai-note-row', { hasText: NOTE_TEXT })).toHaveCount(0);

    await expandAll(page);

    const note = page.locator('.ai-note-row', { hasText: NOTE_TEXT });
    await expect(note).toHaveCount(1, { timeout: 5000 });
    // It renders full-width — never trapped inside one split column.
    expect(await note.first().evaluate(el => el.closest('.split-col') === null)).toBe(true);
    // It sits right after the line it anchors to (line 20).
    await expect(page.locator('.diff-line[data-line="20"][data-side="new"]').first()).toBeVisible();
  });
}
