import { test, expect } from './coverage-fixture.js';

/**
 * doc 25 — reviewer file attachments on feedback items. Creates a fresh
 * annotation, attaches a file through the attach button (file chooser), and
 * checks the chip renders, survives a reload (hydrated from the server), and
 * can be removed.
 */

async function openFile(page: import('@playwright/test').Page, nameText: string) {
  await page.goto('/');
  await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
  await page.locator('.file-item .file-name', { hasText: nameText }).click();
  await expect(page.locator('.diff-view')).toHaveAttribute('data-file-path', new RegExp(nameText), { timeout: 5000 });
}

test.describe('Annotation attachments (doc 25)', () => {
  test('attach a file to an annotation; chip renders, persists, and removes', async ({ page }) => {
    await openFile(page, 'session');

    // Create a uniquely-identifiable annotation so the test is self-contained
    // against the shared demo server.
    const marker = `attach-target-${Date.now().toString(36)}`;
    await page.locator('.diff-line.add').first().click();
    const form = page.locator('.annotation-form-container[data-form-key]');
    await expect(form).toBeVisible({ timeout: 3000 });
    await form.locator('textarea').fill(marker);
    await form.locator('textarea').press('Control+Enter');

    const row = page.locator('.annotation-item', { hasText: marker });
    await expect(row).toBeVisible({ timeout: 5000 });

    // Attach a file via the attach button (opens a hidden file input).
    const chooserPromise = page.waitForEvent('filechooser');
    await row.locator('[data-action="attach"]').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('repro steps') });

    const chip = row.locator('.attachment-chip', { hasText: 'evidence.txt' });
    await expect(chip).toBeVisible({ timeout: 5000 });

    // Survives a reload — the chip is hydrated from the server, not just local.
    await openFile(page, 'session');
    const reloadedRow = page.locator('.annotation-item', { hasText: marker });
    await expect(reloadedRow.locator('.attachment-chip', { hasText: 'evidence.txt' }))
      .toBeVisible({ timeout: 5000 });

    // Remove it — the chip disappears.
    await reloadedRow.locator('.attachment-chip', { hasText: 'evidence.txt' })
      .locator('.attachment-chip-remove').click();
    await expect(reloadedRow.locator('.attachment-chip', { hasText: 'evidence.txt' }))
      .toHaveCount(0, { timeout: 5000 });

    // Gone after another reload too (server delete, not just DOM removal).
    await openFile(page, 'session');
    await expect(page.locator('.annotation-item', { hasText: marker })
      .locator('.attachment-chip', { hasText: 'evidence.txt' }))
      .toHaveCount(0, { timeout: 5000 });
  });
});
