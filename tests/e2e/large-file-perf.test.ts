import { test, expect } from './coverage-fixture.js';

/**
 * GB-821 — selecting a large minified SVG must not lock up the UI.
 *
 * The diff viewer shows SVGs as a text diff by default (svgViewMode = 'code').
 * `assets/icons.min.svg` in demo scenario 4 is a ~600 KB single-line SVG. The
 * original bug ran highlight.js synchronously on that whole line, freezing the
 * browser's main thread for seconds — so the user "couldn't switch to another
 * file" even though the server stayed responsive. The fix skips syntax
 * highlighting for pathologically long lines, the same way char-level diffing
 * already bails on them.
 *
 * These tests assert the symptom (main-thread freeze) is gone, plus the
 * mechanism (the giant line is left unhighlighted) so a regression is caught
 * deterministically and not just via a timing threshold.
 */

const SVG_FILE = 'icons.min.svg';

async function openFileList(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#progress-summary')).toHaveText(/files reviewed/, { timeout: 5000 });
}

/**
 * Install a Long Tasks observer that accumulates total main-thread blocking
 * time (the sum of every task longer than 50 ms — the browser only reports
 * those). A freeze is felt as the *sum* of back-to-back long tasks (highlight,
 * then layout of the spans it injected), not any single one, so summing is the
 * metric that matches the user's experience. Normal interaction reports zero.
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
  test('selecting a large minified SVG does not freeze the main thread', async ({ page }) => {
    await openFileList(page);

    // Land on a normal file first, so the recorder measures *only* the work of
    // selecting the large SVG — independent of which file the app auto-selects
    // on load. (Without this the recorder could race the initial-load render.)
    await page.locator('.file-item .file-name', { hasText: 'session.ts' }).click();
    await expect(page.locator('.diff-view')).toHaveAttribute(
      'data-file-path', /session\.ts/, { timeout: 5000 });

    // Throttle the CPU so this test is a real guard, not one that only passes
    // on fast CI hardware. Highlighting the giant line (pre-fix) injects tens
    // of thousands of <span>s whose layout cost is what froze the user's
    // machine and the Tauri webview; 6x throttling reproduces that here. With
    // the fix (the giant line is not highlighted) the work stays trivial.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });

    await startBlockingRecorder(page);
    await page.locator('.file-item .file-name', { hasText: SVG_FILE }).click();

    // Diff renders as a text diff (code view is the default for SVGs).
    await expect(page.locator('.diff-view')).toHaveAttribute(
      'data-file-path', new RegExp(SVG_FILE), { timeout: 10000 });
    await expect(page.locator('.diff-line').first()).toBeVisible({ timeout: 10000 });

    // Give any deferred highlight/layout work a chance to run, then check that
    // no single main-thread task ran long enough to feel like a freeze. Even
    // throttled 6x the fixed path stays well under this; the pre-fix path
    // blocked for several seconds.
    await page.waitForTimeout(800);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const blocked = await totalBlockMs(page);
    console.log(`[GB-821] total main-thread blocking (6x throttle) = ${blocked.toFixed(0)}ms`);
    // With the fix the only cost is laying out the (unhighlighted) 1 MB text
    // line — about 600 ms at 6x throttle here. Pre-fix, highlighting that line
    // injected ~100k spans and blocked for ~6 s at the same throttle. The
    // budget sits ~4x above the fixed cost and ~2.5x below the broken cost, so
    // it catches the regression without flaking on slower CI hardware.
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

  test('the giant SVG line is rendered without syntax highlighting', async ({ page }) => {
    await openFileList(page);
    await page.locator('.file-item .file-name', { hasText: SVG_FILE }).click();
    await expect(page.locator('.diff-view')).toHaveAttribute(
      'data-file-path', new RegExp(SVG_FILE), { timeout: 5000 });
    await expect(page.locator('.diff-line').first()).toBeVisible({ timeout: 5000 });

    // The pathological `.code` cell holds hundreds of KB of text. After the
    // fix it is left as a plain text node — highlight.js (which would inject
    // many <span> children) is skipped for it. Find the longest cell and
    // assert it has no element children.
    const childCounts = await page.locator('.diff-line .code').evaluateAll((cells) =>
      cells
        .map((c) => ({ len: (c.textContent ?? '').length, children: c.childElementCount }))
        .filter((c) => c.len > 100000));
    expect(childCounts.length, 'expected at least one giant code cell').toBeGreaterThan(0);
    for (const c of childCounts) {
      expect(c.children, 'giant code cell should not be syntax-highlighted').toBe(0);
    }
  });
});
