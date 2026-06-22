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

  // GB-958: an image attachment shows a thumbnail and opens the in-app overlay.
  test('an image attachment shows a thumbnail and opens the preview overlay', async ({ page }) => {
    await openFile(page, 'session');

    const marker = `img-attach-${Date.now().toString(36)}`;
    await page.locator('.diff-line.add').first().click();
    const form = page.locator('.annotation-form-container[data-form-key]');
    await expect(form).toBeVisible({ timeout: 3000 });
    await form.locator('textarea').fill(marker);
    await form.locator('textarea').press('Control+Enter');

    const row = page.locator('.annotation-item', { hasText: marker });
    await expect(row).toBeVisible({ timeout: 5000 });

    // A tiny 1x1 PNG.
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/T9fAAAAAElFTkSuQmCC';
    const chooserPromise = page.waitForEvent('filechooser');
    await row.locator('[data-action="attach"]').click();
    (await chooserPromise).setFiles({ name: 'design.png', mimeType: 'image/png', buffer: Buffer.from(pngBase64, 'base64') });

    const chip = row.locator('.attachment-chip', { hasText: 'design.png' });
    await expect(chip).toBeVisible({ timeout: 5000 });
    // Thumbnail (not the generic file icon) renders on the chip.
    await expect(chip.locator('img.attachment-chip-thumb')).toBeVisible();

    // Click opens the in-app overlay with the image; Escape closes it.
    await chip.click();
    const overlay = page.locator('.lightbox-overlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await expect(overlay.locator('img.lightbox-img')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0, { timeout: 3000 });

    // Cleanup so the shared session doesn't accumulate.
    await chip.locator('.attachment-chip-remove').click();
    await expect(chip).toHaveCount(0, { timeout: 5000 });
  });

  // GB-957: pasting a file while a feedback item is focused attaches it.
  test('paste a file onto a focused annotation chip attaches it', async ({ page }) => {
    await openFile(page, 'session');

    const marker = `paste-target-${Date.now().toString(36)}`;
    await page.locator('.diff-line.add').first().click();
    const form = page.locator('.annotation-form-container[data-form-key]');
    await expect(form).toBeVisible({ timeout: 3000 });
    await form.locator('textarea').fill(marker);
    await form.locator('textarea').press('Control+Enter');
    const row = page.locator('.annotation-item', { hasText: marker });
    await expect(row).toBeVisible({ timeout: 5000 });

    // Seed one attachment so there's a focusable chip in the row.
    const chooserPromise = page.waitForEvent('filechooser');
    await row.locator('[data-action="attach"]').click();
    (await chooserPromise).setFiles({ name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('one') });
    const firstChip = row.locator('.attachment-chip', { hasText: 'first.txt' });
    await expect(firstChip).toBeVisible({ timeout: 5000 });

    // Focus the chip, then dispatch a clipboard paste carrying a file.
    await firstChip.evaluate((el: HTMLElement) => {
      el.focus();
      const dt = new DataTransfer();
      dt.items.add(new File(['pasted body'], 'pasted.txt', { type: 'text/plain' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });

    // The pasted file lands on the same annotation as a second chip.
    await expect(row.locator('.attachment-chip', { hasText: 'pasted.txt' })).toBeVisible({ timeout: 5000 });

    // Persists across reload.
    await openFile(page, 'session');
    await expect(page.locator('.annotation-item', { hasText: marker })
      .locator('.attachment-chip', { hasText: 'pasted.txt' })).toBeVisible({ timeout: 5000 });
  });

  // GB-956: the attachment bar also works on image-feedback comments (doc 23).
  test('attach a file to an image-feedback comment', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
    await page.locator('.file-item .file-name', { hasText: '128x128.png' }).click();
    await expect(page.locator('.image-diff')).toBeVisible({ timeout: 5000 });

    const panel = page.locator('[data-image-feedback]');
    await expect(panel.locator('[data-role="general-input"]')).toBeVisible({ timeout: 5000 });
    const marker = `imgfb-${Date.now().toString(36)}`;
    await panel.locator('[data-role="general-input"]').fill(marker);
    await panel.locator('[data-action="add-general"]').click();

    const item = panel.locator('.image-feedback-item', { hasText: marker });
    await expect(item).toBeVisible({ timeout: 5000 });

    const chooserPromise = page.waitForEvent('filechooser');
    await item.locator('[data-action="attach"]').click();
    (await chooserPromise).setFiles({ name: 'imgnote.txt', mimeType: 'text/plain', buffer: Buffer.from('note') });

    await expect(item.locator('.attachment-chip', { hasText: 'imgnote.txt' })).toBeVisible({ timeout: 5000 });

    // Cleanup: deleting the comment cascades its attachment.
    await item.locator('[data-action="delete"]').click();
    await expect(panel.locator('.image-feedback-item', { hasText: marker })).toHaveCount(0, { timeout: 5000 });
  });
});
