import { test, expect } from './coverage-fixture.js';

// Demo scenario 4 pre-populates annotations on these files:
//   src/auth/session.ts    — 3 annotations (bug, fix, pattern-follow) + 1 reply to a review note
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
  // Wait for the requested file's content to settle — the diff loads async,
  // so the visible `.diff-view` may briefly belong to a different file
  // (e.g. an auto-selected initial file) before the click-driven fetch resolves.
  await expect(page.locator('.diff-view')).toHaveAttribute('data-file-path', new RegExp(nameText), { timeout: 5000 });
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

  // GB-796 — clicking the create form's category badge silently did nothing
  // because the delegated handler only matched the edit form
  // (`[data-edit-for]`), not the create form (`[data-form-key]`). The user-
  // visible symptom: "you can change the issue type after submitting, but
  // not during initial entry."
  test('category badge in the create form opens the picker and applies the chosen category', async ({ page }) => {
    await openFile(page, 'session');
    await page.locator('.diff-line.add').first().click();
    const form = page.locator('.annotation-form-container[data-form-key]');
    await expect(form).toBeVisible({ timeout: 3000 });

    const badge = form.locator('.form-category-badge');
    const startLabel = (await badge.textContent() ?? '').trim();
    await badge.click();
    const popup = page.locator('.reclassify-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });

    // Pick whichever category isn't currently active, so the assertion is
    // meaningful regardless of which default the form opens with.
    const targetOption = popup.locator('.reclassify-option:not(.active)').first();
    const targetText = (await targetOption.locator('.annotation-category').textContent() ?? '').trim();
    await targetOption.click();
    await expect(popup).not.toBeVisible({ timeout: 3000 });
    await expect(badge).toHaveText(targetText);
    expect(targetText).not.toBe(startLabel);
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

  // GB-1133: the picker is positioned by popup.ts `positionBelowAnchor`, which
  // now uses kerfjs/overlay `autoReposition` — so the popup follows its anchor
  // as the diff scrolls instead of drifting away. Scrolls DOWN (content moves
  // up) so there's no bottom-viewport-overflow flip to reason about.
  test('reclassify picker tracks its badge when the diff scrolls (autoReposition)', async ({ page }) => {
    await openFile(page, 'session');
    const badge = page.locator('[data-action="reclassify"]').first();
    await expect(badge).toBeVisible();
    await badge.click();
    await expect(page.locator('.reclassify-popup')).toBeVisible({ timeout: 3000 });

    const readBoxes = () => page.evaluate(() => {
      const b = document.querySelector('[data-action="reclassify"]')!.getBoundingClientRect();
      const p = document.querySelector('.reclassify-popup')!.getBoundingClientRect();
      return { badgeTop: b.top, pickerTop: p.top };
    });

    const before = await readBoxes();

    // Scroll the nearest scrollable ancestor of the badge (fall back to window).
    // Setting scrollTop fires a capture-phase scroll event, which drives
    // autoReposition.
    const scrolled = await page.evaluate(() => {
      let el = document.querySelector('[data-action="reclassify"]')?.parentElement ?? null;
      while (el !== null) {
        const oy = getComputedStyle(el).overflowY;
        if (el.scrollHeight > el.clientHeight && (oy === 'auto' || oy === 'scroll')) {
          const prev = el.scrollTop;
          el.scrollTop += 60;
          if (el.scrollTop !== prev) return true;
        }
        el = el.parentElement;
      }
      const prevY = window.scrollY;
      window.scrollBy(0, 60);
      return window.scrollY !== prevY;
    });
    expect(scrolled).toBe(true);

    // The badge moves synchronously with the scroll; the picker repositions on
    // the scroll event autoReposition listens for, which can lag a frame or two
    // under load — so poll until the badge has moved AND the picker has tracked
    // it by the same delta (stayed glued), rather than reading once on a fixed
    // timer. Old position-once behavior would leave pickerDelta ~0 forever and
    // time out here.
    await expect.poll(async () => {
      const after = await readBoxes();
      const badgeDelta = after.badgeTop - before.badgeTop;
      const pickerDelta = after.pickerTop - before.pickerTop;
      return Math.abs(badgeDelta) > 10 && Math.abs(pickerDelta - badgeDelta) < 2;
    }, { timeout: 3000 }).toBe(true);
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

  // The browser's own verdict, not the markup's: `HTMLElement.draggable` is what
  // decides whether a real mouse gesture can start a drag at all. A bare
  // `<span draggable>` reads back as false (invalid value -> `auto` -> off for a
  // span), which is what shipped until the drag handle was given the keyword
  // string. The gesture tests below dispatch `dragstart` directly and so pass
  // either way — this is the assertion that actually holds the feature up.
  test('drag handle is natively draggable, and images are not', async ({ page }) => {
    await openFile(page, 'session');
    await expect(page.locator('.annotation-item').first()).toBeVisible();
    const handleDraggable = await page.locator('.annotation-drag-handle').first()
      .evaluate((el: HTMLElement) => el.draggable);
    expect(handleDraggable).toBe(true);
  });
});

// Real drag-gesture coverage (GB-1088): the suite previously asserted only
// that the drag HANDLE is visible; the gesture itself — HTML5 dragstart on the
// handle, dragover/drop on a `.diff-line`, the move API call, and the
// post-move refetch that re-anchors the row — was untested. Feature-coverage
// unit 5.4 points here.
test.describe('Annotation drag-and-drop', () => {
  /** The diff line an annotation row is anchored beneath, after render. */
  function anchorOf(page: import('@playwright/test').Page, annotationId: string) {
    return page.evaluate((id) => {
      const item = document.querySelector(`.annotation-item[data-annotation-id="${id}"]`);
      const row = item?.closest('.annotation-row');
      const prev = row?.previousElementSibling;
      if (!prev) return null;
      const line = prev.matches('.diff-line')
        ? prev
        : prev.querySelector('.diff-line[data-side="new"]') ?? prev.querySelector('.diff-line');
      if (!line) return null;
      return { line: line.getAttribute('data-line'), side: line.getAttribute('data-side') };
    }, annotationId);
  }

  /** A context-line number on the given side that differs from `notLine`. */
  function pickTargetLine(page: import('@playwright/test').Page, notLine: string | null) {
    return page.evaluate((cur) => {
      const lines = Array.from(document.querySelectorAll('.diff-line.context[data-side="new"]'));
      const el = lines.find((l) => {
        const n = l.getAttribute('data-line');
        return n !== null && n !== '' && n !== cur;
      });
      return el?.getAttribute('data-line') ?? null;
    }, notLine);
  }

  /** Drive the HTML5 drag event sequence. Playwright's mouse-based dragTo does
   *  not synthesize HTML5 drag events in headless Chromium, so dispatch the
   *  sequence the browser would fire: dragstart on the handle, dragover + drop
   *  on the target line, dragend to finish. The app's delegated handlers see
   *  exactly the events a real drag produces. */
  async function dragHandleTo(
    page: import('@playwright/test').Page,
    handle: import('@playwright/test').Locator,
    target: import('@playwright/test').Locator,
  ): Promise<void> {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer });
    await target.dispatchEvent('dragover', { dataTransfer });
    await target.dispatchEvent('drop', { dataTransfer });
    await page.dispatchEvent('body', 'dragend');
  }

  for (const mode of ['split', 'unified'] as const) {
    test(`drag → drop moves the annotation, then drags again (${mode} mode)`, async ({ page }) => {
      await openFile(page, 'users');
      if (mode === 'unified') {
        await page.locator(`[data-diff-mode="unified"]`).click();
        await expect(page.locator('.diff-table-unified')).toBeVisible();
      }
      const item = page.locator('.annotation-item').first();
      await expect(item).toBeVisible();
      const id = await item.getAttribute('data-annotation-id');
      if (id === null) throw new Error('annotation id missing');

      const before = await anchorOf(page, id);
      const targetLine = await pickTargetLine(page, before?.line ?? null);
      if (targetLine === null) throw new Error('no drop target found');
      const target = page.locator(`.diff-line.context[data-side="new"][data-line="${targetLine}"]`).first();

      const moveReq = page.waitForRequest(
        (r) => r.url().includes(`/api/annotations/${id}/move`) && r.method() === 'PATCH',
      );
      await dragHandleTo(page, item.locator('.annotation-drag-handle'), target);
      const req = await moveReq;
      expect(req.postDataJSON()).toMatchObject({ lineNumber: parseInt(targetLine, 10), side: 'new' });

      // The move triggers a diff refetch; the row re-anchors under the target.
      await expect.poll(() => anchorOf(page, id), { timeout: 5000 }).toMatchObject({ line: targetLine });

      // The gesture must be repeatable: drag the same annotation again.
      const secondLine = await pickTargetLine(page, targetLine);
      if (secondLine === null) throw new Error('no second drop target found');
      const secondTarget = page.locator(`.diff-line.context[data-side="new"][data-line="${secondLine}"]`).first();
      const secondReq = page.waitForRequest(
        (r) => r.url().includes(`/api/annotations/${id}/move`) && r.method() === 'PATCH',
      );
      await dragHandleTo(
        page,
        page.locator(`.annotation-item[data-annotation-id="${id}"] .annotation-drag-handle`),
        secondTarget,
      );
      await secondReq;
      await expect.poll(() => anchorOf(page, id), { timeout: 5000 }).toMatchObject({ line: secondLine });
    });
  }

  test('drag across sides: dropping on a removed line moves to the old side (unified mode)', async ({ page }) => {
    await openFile(page, 'session');
    await page.locator(`[data-diff-mode="unified"]`).click();
    await expect(page.locator('.diff-table-unified')).toBeVisible();

    const item = page.locator('.annotation-item').first();
    await expect(item).toBeVisible();
    const id = await item.getAttribute('data-annotation-id');
    if (id === null) throw new Error('annotation id missing');

    // In unified mode a removed line carries data-side="old" with no paired
    // new-line fallback, so the drop lands on the old side.
    const target = page.locator('.diff-line.remove[data-side="old"]').first();
    await expect(target).toBeVisible();
    const targetLine = await target.getAttribute('data-line');

    const moveReq = page.waitForRequest(
      (r) => r.url().includes(`/api/annotations/${id}/move`) && r.method() === 'PATCH',
    );
    await dragHandleTo(page, item.locator('.annotation-drag-handle'), target);
    const req = await moveReq;
    expect(req.postDataJSON()).toMatchObject({ lineNumber: parseInt(targetLine ?? '0', 10), side: 'old' });
    await expect.poll(() => anchorOf(page, id), { timeout: 5000 }).toMatchObject({ line: targetLine, side: 'old' });

    // Restore the split default for later tests.
    await page.locator(`[data-diff-mode="split"]`).click();
  });

  test('canceled drag: next line click opens the create form, not a move', async ({ page }) => {
    await openFile(page, 'users');
    const item = page.locator('.annotation-item').first();
    await expect(item).toBeVisible();

    const moves: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/move')) moves.push(r.url());
    });

    // Start a drag, then abandon it (dragend without a drop — the browser
    // fires this for Escape or dropping outside a valid target).
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await item.locator('.annotation-drag-handle').dispatchEvent('dragstart', { dataTransfer });
    // Mid-drag: a line under the cursor highlights as the drop target.
    const hoverLine = page.locator('.diff-line.context[data-side="new"]').first();
    await hoverLine.dispatchEvent('dragover', { dataTransfer });
    await expect(hoverLine).toHaveClass(/drag-over/);
    await page.dispatchEvent('body', 'dragend');
    // The abandoned drag cleans up its highlight.
    await expect(page.locator('.diff-line.drag-over')).toHaveCount(0);

    // The next click must open the CREATE form — a lingering dragStore value
    // would have routed it into a move instead.
    await page.locator('.diff-line.add').first().click();
    await expect(page.locator('.annotation-form-container[data-form-key]')).toBeVisible({ timeout: 3000 });
    expect(moves).toHaveLength(0);
    await page.keyboard.press('Escape');
  });

  test('a drag canceled while an edit form is open leaves the form and its text intact', async ({ page }) => {
    await openFile(page, 'users');
    const items = page.locator('.annotation-item');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThanOrEqual(2);

    // Open the edit form on annotation A and type into it.
    await items.first().locator('[data-action="edit"]').click();
    const form = page.locator('.annotation-form-container[data-edit-for]');
    await expect(form).toBeVisible();
    const textarea = form.locator('textarea');
    await textarea.fill('mid-edit draft that must survive');

    // Drag annotation B (start + cancel) while A's edit form is open.
    const otherHandle = page.locator('.annotation-item:not(:has(.annotation-form-container)) .annotation-drag-handle').last();
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await otherHandle.dispatchEvent('dragstart', { dataTransfer });
    await page.dispatchEvent('body', 'dragend');

    // The form (and the in-progress text, held in editFormSignal) survives.
    await expect(form).toBeVisible();
    await expect(form.locator('textarea')).toHaveValue('mid-edit draft that must survive');
    await page.keyboard.press('Escape');
    await expect(form).not.toBeVisible();
  });
});
