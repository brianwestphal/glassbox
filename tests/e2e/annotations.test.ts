import { test, expect } from './coverage-fixture.js';

// Demo scenario 4 pre-populates annotations on these files:
//   src/auth/session.ts    — 3 annotations (bug, fix, pattern-follow)
//   src/api/routes/users.ts — 3 annotations (pattern-follow, style, fix)
//   src/db/redis.ts          — 1 annotation (note)
//   src/middleware/auth.ts   — 1 annotation (fix)
//   src/utils/password.ts    — 1 annotation (remember)

async function openFile(page: import('@playwright/test').Page, nameText: string) {
  await page.goto('/');
  // Wait for client JS to render the file list (it re-renders after server-side HTML)
  await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
  await page.locator('.file-item .file-name', { hasText: nameText }).click();
  await expect(page.locator('.diff-view')).toBeVisible();
}

test.describe('Pre-existing annotations', () => {
  test('session.ts has annotations with correct categories', async ({ page }) => {
    await openFile(page, 'session');
    const annotations = page.locator('.annotation-item');
    await expect(annotations.first()).toBeVisible();
    // Demo 4 creates 3 annotations; may be fewer if a prior test deleted one
    expect(await annotations.count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.category-bug')).toBeVisible();
    await expect(page.locator('.category-fix')).toBeVisible();
  });

  test('annotations display content text', async ({ page }) => {
    await openFile(page, 'session');
    const text = await page.locator('.annotation-text').first().textContent();
    expect(text!.length).toBeGreaterThan(10);
  });

  test('users.ts has 3 annotations', async ({ page }) => {
    await openFile(page, 'users');
    await expect(page.locator('.annotation-item').first()).toBeVisible();
    expect(await page.locator('.annotation-item').count()).toBe(3);
  });

  test('redis.ts has a note annotation', async ({ page }) => {
    await openFile(page, 'redis');
    await expect(page.locator('.category-note')).toBeVisible();
  });

  test('password.ts has a remember annotation', async ({ page }) => {
    await openFile(page, 'password');
    await expect(page.locator('.category-remember')).toBeVisible();
  });
});

test.describe('Annotation count badges', () => {
  test('files with annotations show count badge in sidebar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.file-item').first()).toBeVisible();
    const badges = page.locator('.annotation-count');
    await expect(badges.first()).toBeVisible();
  });
});

test.describe('Progress summary', () => {
  test('progress summary shows file review count', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
  });
});

test.describe('Create annotation', () => {
  test('clicking a diff line opens annotation form', async ({ page }) => {
    await openFile(page, 'session');
    const addLine = page.locator('.diff-line.add').first();
    await expect(addLine).toBeVisible();
    await addLine.click();
    await expect(page.locator('.annotation-form')).toBeVisible({ timeout: 3000 });
  });

  test('annotation form has textarea', async ({ page }) => {
    await openFile(page, 'session');
    await page.locator('.diff-line.add').first().click();
    await expect(page.locator('.annotation-form')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.annotation-form textarea')).toBeVisible();
  });

  test('escape closes annotation form', async ({ page }) => {
    await openFile(page, 'session');
    await page.locator('.diff-line.add').first().click();
    await expect(page.locator('.annotation-form')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.annotation-form')).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe('Edit annotation', () => {
  test('edit button opens edit form', async ({ page }) => {
    await openFile(page, 'session');
    await page.locator('[data-action="edit"]').first().click();
    await expect(page.locator('.annotation-form')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Delete annotation', () => {
  test('delete button removes annotation', async ({ page }) => {
    await openFile(page, 'session');
    const countBefore = await page.locator('.annotation-item').count();
    expect(countBefore).toBeGreaterThan(0);
    await page.locator('[data-action="delete"]').first().click();
    await expect(page.locator('.annotation-item')).toHaveCount(countBefore - 1, { timeout: 5000 });
  });
});

test.describe('Category reclassify', () => {
  test('clicking category badge opens picker', async ({ page }) => {
    await openFile(page, 'session');
    await page.locator('[data-action="reclassify"]').first().click();
    // Reclassify popup should appear
    await expect(page.locator('.reclassify-popup')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Annotation UI elements', () => {
  test('annotations have drag handle, edit, and delete buttons', async ({ page }) => {
    await openFile(page, 'session');
    const annotation = page.locator('.annotation-item').first();
    await expect(annotation).toBeVisible();
    await expect(annotation.locator('.annotation-drag-handle')).toBeVisible();
    await expect(annotation.locator('[data-action="edit"]')).toBeVisible();
    await expect(annotation.locator('[data-action="delete"]')).toBeVisible();
    await expect(annotation.locator('[data-action="reclassify"]')).toBeVisible();
  });
});
