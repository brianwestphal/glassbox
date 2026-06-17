import { test, expect } from './coverage-fixture.js';

test.describe('File filter', () => {
  test('filters files by name and clears to restore all', async ({ page }) => {
    await page.goto('/');
    // Wait for client JS to fully render the file list
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    const allCount = await page.locator('.file-item').count();
    expect(allCount).toBeGreaterThan(1);

    // Focus the filter and type to filter
    const filterInput = page.locator('#file-filter');
    await filterInput.focus();
    await filterInput.fill('package');
    await filterInput.dispatchEvent('input');
    // "package" should match only package.json (1 file)
    await expect(page.locator('.file-item')).toHaveCount(1, { timeout: 3000 });

    // Press Escape to clear filter (the keydown handler clears and re-renders)
    await filterInput.focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('.file-item')).toHaveCount(allCount, { timeout: 3000 });
  });
});

test.describe('Folder tree', () => {
  test('folder headers exist', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    const folderHeaders = page.locator('.folder-header');
    const count = await folderHeaders.count();
    expect(count).toBeGreaterThan(0);
  });

  test('collapse and expand a folder', async ({ page }) => {
    await page.goto('/');
    // Wait for client JS to render the file list and bind click handlers
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    const collapsible = page.locator('.folder-header.collapsible').first();
    if (await collapsible.count() === 0) return;

    // Click the folder header to collapse
    await collapsible.click();
    await expect(collapsible).toHaveClass(/collapsed/, { timeout: 2000 });

    // Click again to expand
    await collapsible.click();
    await expect(collapsible).not.toHaveClass(/collapsed/, { timeout: 2000 });
  });
});

test.describe('File status', () => {
  test('status dots exist on file items', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    const statusDots = page.locator('.file-item .status-dot');
    const count = await statusDots.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking a file loads its diff and marks it reviewed', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    // Click a file to load its diff
    const firstFile = page.locator('.file-item').first();
    await firstFile.click();
    await expect(page.locator('.diff-view')).toBeVisible();

    // After visiting, the file's status dot should reflect "reviewed"
    const statusDot = firstFile.locator('.status-dot');
    await expect(statusDot).toHaveClass(/reviewed/);
  });
});

test.describe('Progress bar', () => {
  test('progress summary shows file count info', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/\d+ of \d+ files reviewed/, { timeout: 5000 });
  });
});

test.describe('Active file highlighting', () => {
  test('clicking a file gives it active class, clicking another transfers it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    const fileItems = page.locator('.file-item');
    const count = await fileItems.count();
    expect(count).toBeGreaterThan(1);

    // Click the first file
    const firstFile = fileItems.nth(0);
    await firstFile.click();
    await expect(page.locator('.diff-view')).toBeVisible();
    await expect(firstFile).toHaveClass(/active/);

    // Click the second file
    const secondFile = fileItems.nth(1);
    await secondFile.click();
    await expect(secondFile).toHaveClass(/active/);
    await expect(firstFile).not.toHaveClass(/active/);
  });
});

test.describe('Sort mode control', () => {
  test('segmented control has Folder, Risk, and Narrative buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();

    const folderBtn = page.locator('[data-sort-mode="folder"]');
    const riskBtn = page.locator('[data-sort-mode="risk"]');
    const narrativeBtn = page.locator('[data-sort-mode="narrative"]');

    await expect(folderBtn).toBeVisible();
    await expect(riskBtn).toBeVisible();
    await expect(narrativeBtn).toBeVisible();

    // Folder mode should be active by default
    await expect(folderBtn).toHaveClass(/active/);
  });
});

test.describe('File context menu (GB-884)', () => {
  test('right-click a file shows a menu whose action POSTs to the reveal endpoint', async ({ page }) => {
    // Intercept the OS-open hand-off so the test machine never actually opens a
    // file manager, and capture which file was revealed.
    let revealedPath: string | null = null;
    await page.route('**/files/*/reveal*', async (route) => {
      revealedPath = new URL(route.request().url()).pathname;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    const firstFile = page.locator('.file-item').first();
    const fileId = await firstFile.getAttribute('data-file-id');
    expect(fileId).toBeTruthy();

    // The native context menu is suppressed; our custom menu appears instead.
    await firstFile.click({ button: 'right' });
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    const item = menu.locator('[data-action="reveal"]');
    await expect(item).toBeVisible();

    await item.click();

    // The action reveals the right file and the menu closes.
    await expect.poll(() => revealedPath, { timeout: 3000 }).toBe(`/api/files/${fileId ?? ''}/reveal`);
    await expect(menu).toHaveCount(0);
  });

  test('Escape and outside-click dismiss the menu without revealing', async ({ page }) => {
    let revealCalled = false;
    await page.route('**/files/*/reveal*', async (route) => {
      revealCalled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    const firstFile = page.locator('.file-item').first();

    // Escape closes the menu.
    await firstFile.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.context-menu')).toHaveCount(0);

    // Outside-click closes the menu.
    await firstFile.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible();
    await page.locator('#diff-container').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.context-menu')).toHaveCount(0);

    // Neither dismissal triggered a reveal.
    expect(revealCalled).toBe(false);
  });

  test('Copy Path copies the absolute path by default and the relative path with Option/Alt (GB-891)', async ({ page }) => {
    // Stub clipboard writeText so we can read what was copied without needing
    // clipboard permissions.
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      const stub = (t: string): Promise<void> => { w.__copied.push(t); return Promise.resolve(); };
      try {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: stub }, configurable: true });
      } catch { /* fall back to assigning the method directly */ }
    });

    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    const firstFile = page.locator('.file-item').first();
    const fileId = await firstFile.getAttribute('data-file-id');

    // The real server resolves both paths; fetch them so we can assert exactly.
    const paths = await page.evaluate(async (id) => {
      const rid = document.body.dataset.reviewId ?? '';
      const res = await fetch(`/api/files/${id ?? ''}/path?reviewId=${rid}`);
      return res.json() as Promise<{ relativePath: string; absolutePath: string }>;
    }, fileId);

    const copied = () => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

    // Default click → absolute path.
    await firstFile.click({ button: 'right' });
    await page.locator('.context-menu [data-action="copy-path"]').click();
    await expect.poll(copied, { timeout: 3000 }).toEqual([paths.absolutePath]);

    // Option/Alt held → relative path.
    await firstFile.click({ button: 'right' });
    await page.locator('.context-menu [data-action="copy-path"]').click({ modifiers: ['Alt'] });
    await expect.poll(copied, { timeout: 3000 }).toEqual([paths.absolutePath, paths.relativePath]);
  });

  test('Mark reviewed/pending toggles the file status (GB-891)', async ({ page }) => {
    let patched: { status?: string } | null = null;
    await page.route('**/files/*/status*', async (route) => {
      patched = route.request().postDataJSON() as { status?: string };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });

    // Use a non-active row so we're not racing the auto-select-first-file mark.
    const row = page.locator('.file-item').nth(2);
    const dot = row.locator('.status-dot');
    const wasReviewed = await dot.evaluate((el) => el.classList.contains('reviewed'));

    patched = null; // ignore any PATCH from the load-time auto-select
    await row.click({ button: 'right' });
    await page.locator('.context-menu [data-action="toggle-status"]').click();

    const expectedNext = wasReviewed ? 'pending' : 'reviewed';
    await expect.poll(() => patched, { timeout: 3000 }).toEqual({ status: expectedNext });
    if (expectedNext === 'reviewed') {
      await expect(dot).toHaveClass(/reviewed/);
    } else {
      await expect(dot).not.toHaveClass(/reviewed/);
    }
  });

  test('Open in Default Editor POSTs to the open endpoint (GB-891)', async ({ page }) => {
    let openedPath: string | null = null;
    await page.route('**/files/*/open*', async (route) => {
      openedPath = new URL(route.request().url()).pathname;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    const firstFile = page.locator('.file-item').first();
    const fileId = await firstFile.getAttribute('data-file-id');

    await firstFile.click({ button: 'right' });
    await page.locator('.context-menu [data-action="open-editor"]').click();
    await expect.poll(() => openedPath, { timeout: 3000 }).toBe(`/api/files/${fileId ?? ''}/open`);
  });
});
