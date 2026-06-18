import { test, expect } from './coverage-fixture.js';

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
    await expect(rows).toHaveCount(4);
    // Per-kind badges + producer attribution.
    await expect(page.locator('.ai-note-label-rationale')).toBeVisible();
    await expect(page.locator('.ai-note-label-risk')).toBeVisible();
    await expect(page.locator('.ai-note-producer').first()).toHaveText('Claude Code');
    // The re-anchored note whose code changed is flagged outdated (P3).
    await expect(page.locator('.ai-note-row.ai-note-stale')).toHaveCount(1);
    await expect(page.locator('.ai-note-stale-tag')).toHaveText('outdated');
  });

  test('review notes also render in unified mode', async ({ page }) => {
    await openModifiedFile(page);
    await page.locator('[data-diff-mode="unified"]').click();
    await expect(page.locator('.diff-table-unified')).toBeVisible();
    await expect(page.locator('.ai-note-row.ai-note-review').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ai-note-row.ai-note-review')).toHaveCount(4);
    await expect(page.locator('.ai-note-row.ai-note-stale')).toHaveCount(1);
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
