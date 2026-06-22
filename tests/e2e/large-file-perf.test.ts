import { test, expect } from './coverage-fixture.js';

/**
 * GB-821 — selecting a large minified SVG must not lock up the UI.
 *
 * The diff viewer shows SVGs as a text diff by default (svgViewMode = 'code').
 * `assets/icons.min.svg` in demo scenario 4 is a ~850 KB single-line SVG. The
 * original bug put that whole line into the DOM as one giant text node; laying
 * it out and painting a multi-million-pixel-wide line froze the browser's main
 * thread for seconds — the user "couldn't switch to another file." (Skipping
 * syntax highlighting alone wasn't enough: the plain giant text node still has
 * to be laid out and painted, which is why the freeze survived that fix.)
 *
 * The fix truncates a line's *displayed* content past `MAX_DIFF_LINE_LENGTH`,
 * server-side, so the DOM never holds a giant line — a bounded prefix plus a
 * `.line-truncated` marker is rendered instead.
 *
 * NOTE ON TEST FIDELITY: the worst of the freeze is real-window paint /
 * compositing, which a *headless* browser largely skips — so a timing-only
 * assertion here under-measures the real cost and a regression could slip
 * through it. The load-bearing guard is therefore the *mechanism*: that the
 * giant line's rendered text is bounded and carries the truncation marker.
 * That holds in any engine, headless or not.
 */

const SVG_FILE = 'icons.min.svg';

async function openFileList(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
}

/**
 * Force the SVG *code* (text) view, the subject of these tests. `svg_view_mode`
 * is a server-persisted preference (see `app.tsx`), and the suite shares one
 * demo server — so an earlier spec that toggled an SVG to the Rendered view
 * (e.g. `image-diff.test.ts`) leaves the giant SVG opening as a live `<img>`
 * with no `.diff-line` rows. Click Code to pin the text view regardless of what
 * ran before, then wait for the diff rows to (re)render.
 */
async function ensureCodeView(page: import('@playwright/test').Page) {
  const codeToggle = page.locator('[data-svg-mode="code"]');
  await expect(codeToggle).toBeVisible({ timeout: 5000 });
  await codeToggle.click();
  await expect(page.locator('.diff-line').first()).toBeVisible({ timeout: 5000 });
}

/**
 * Install a Long Tasks observer that accumulates total main-thread blocking
 * time (the sum of every task longer than 50 ms — the browser only reports
 * those). A freeze is felt as the *sum* of back-to-back long tasks, not any
 * single one, so summing is the metric that matches the user's experience.
 */
async function startBlockingRecorder(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __totalBlock: number; __obs?: PerformanceObserver };
    w.__totalBlock = 0;
    w.__obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__totalBlock += entry.duration;
    });
    w.__obs.observe({ entryTypes: ['longtask'] });
  });
}

async function totalBlockMs(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __totalBlock: number }).__totalBlock);
}

test.describe('Large file performance (GB-821)', () => {
  test('the giant SVG line is truncated for display, not rendered in full', async ({ page }) => {
    await openFileList(page);
    await page.locator('.file-item .file-name', { hasText: SVG_FILE }).click();
    await expect(page.locator('.diff-view')).toHaveAttribute(
      'data-file-path', new RegExp(SVG_FILE), { timeout: 5000 });
    await ensureCodeView(page);

    // Every `.code` cell's rendered text must be bounded — the giant line is
    // never put into the DOM in full. (The fixture builds ~850 KB lines; after
    // truncation each cell holds a few KB plus the marker text.) A regression
    // that removed truncation would blow far past this.
    const lengths = await page.locator('.diff-line .code').evaluateAll((cells) =>
      cells.map((c) => (c.textContent ?? '').length));
    expect(lengths.length, 'expected at least one code cell').toBeGreaterThan(0);
    const longest = Math.max(...lengths);
    expect(longest, 'no rendered diff line should hold a giant text node').toBeLessThan(20000);

    // ...and the truncation marker must be present, naming how much was elided.
    const markers = page.locator('.diff-line .code .line-truncated');
    expect(await markers.count(), 'expected a .line-truncated marker on the giant line').toBeGreaterThan(0);
    await expect(markers.first()).toContainText(/more characters hidden/);
  });

  test('selecting a large minified SVG does not freeze the main thread', async ({ page }) => {
    await openFileList(page);

    // Pin the SVG code view (server-persisted; a prior spec may have left it on
    // Rendered) so the timed selection below opens the text diff directly and
    // the recorder measures code-view layout, not a live-rendered `<img>`.
    await page.locator('.file-item .file-name', { hasText: SVG_FILE }).click();
    await ensureCodeView(page);

    // Land on a normal file first, so the recorder measures *only* the work of
    // selecting the large SVG — independent of which file the app auto-selects
    // on load.
    await page.locator('.file-item .file-name', { hasText: 'session.ts' }).click();
    await expect(page.locator('.diff-view')).toHaveAttribute(
      'data-file-path', /session\.ts/, { timeout: 5000 });

    // Throttle the CPU so this stays a real guard rather than one that only
    // passes on fast CI hardware.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });

    await startBlockingRecorder(page);
    await page.locator('.file-item .file-name', { hasText: SVG_FILE }).click();

    await expect(page.locator('.diff-view')).toHaveAttribute(
      'data-file-path', new RegExp(SVG_FILE), { timeout: 10000 });
    await expect(page.locator('.diff-line').first()).toBeVisible({ timeout: 10000 });

    await page.waitForTimeout(800);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const blocked = await totalBlockMs(page);
    console.log(`[GB-821] total main-thread blocking (6x throttle) = ${blocked.toFixed(0)}ms`);
    // With truncation the giant line never reaches the DOM, so the only cost is
    // laying out a few-KB prefix — trivial. Headless can't see the real paint
    // cost, so this is a coarse backstop; the truncation test above is the
    // load-bearing guard.
    expect(blocked, `total main-thread blocking while opening ${SVG_FILE}`).toBeLessThan(2500);
  });

  test('UI stays responsive: another file can be selected immediately after the large SVG', async ({ page }) => {
    await openFileList(page);

    // Select the large SVG, then immediately select a normal file. If the main
    // thread were blocked, this second selection could not resolve quickly.
    await page.locator('.file-item .file-name', { hasText: SVG_FILE }).click();
    await page.locator('.file-item .file-name', { hasText: 'session.ts' }).click();

    await expect(page.locator('.diff-view')).toHaveAttribute(
      'data-file-path', /session\.ts/, { timeout: 4000 });
  });
});
