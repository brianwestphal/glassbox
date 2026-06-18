/**
 * Regression coverage for GB-913 and GB-914 — two facets of one root cause.
 *
 * GB-913: inline AI notes (risk / narrative) must redraw when the sidebar sort
 * mode changes. GB-914: they must also appear automatically when the analysis
 * *completes* while you stay in a mode — not only after you "force switch
 * views". Both stem from `renderAINotes` running only from `runPostRender`,
 * which fires on a diff-generation bump (file / split-unified / whitespace /
 * SVG switch). Neither a sort-mode flip nor an analysis completing bumps the
 * generation, so the inline notes never re-rendered until the user toggled a
 * view to force a diff refetch. The fix made inline-AI-note rendering a
 * dedicated reactive effect over the AI store (`setupAINotesEffect` in
 * `client/diff/index.tsx`), clearing the prior set before drawing the current
 * one so a stale set can't linger across modes.
 *
 * The analysis endpoints are stubbed so the poll completes on its first tick
 * and the notes are keyed to the file actually open in the diff — deterministic
 * and fast, independent of the mock-analysis timing. Each "switch to X →
 * note appears" step is itself a GB-914 case: the note shows up on analysis
 * completion with no further view switch.
 */
import { test, expect } from '@playwright/test';

test.describe('GB-913 / GB-914: inline AI notes redraw on sort-mode switch and on analysis completion', () => {
  test('risk → narrative → folder redraws notes without a split/unified toggle', async ({ page }) => {
    // Captured after selecting a file so the stubbed scores anchor to the open file.
    let selectedFileId = '';

    // The request URLs carry a `?reviewId=…` query string, so each glob ends in
    // `**`. The `/status` route is registered LAST so it wins over the
    // risk/narrative result routes for the overlapping `…/risk/status` URL
    // (Playwright uses the most recently registered matching route).
    await page.route('**/api/ai/analyze**', async (route) => {
      await route.fulfill({ json: { analysisId: 'test-analysis', status: 'running' } });
    });
    await page.route('**/api/ai/analysis/risk**', async (route) => {
      await route.fulfill({ json: {
        status: 'completed',
        scores: [{ reviewFileId: selectedFileId, filePath: 'x', sortOrder: 0, aggregateScore: 0.8, rationale: 'r', dimensionScores: { aggregate: 0.8 }, notes: { overview: 'RISKOVERVIEWMARKER', lines: [] } }],
      } });
    });
    await page.route('**/api/ai/analysis/narrative**', async (route) => {
      await route.fulfill({ json: {
        status: 'completed',
        scores: [{ reviewFileId: selectedFileId, filePath: 'x', sortOrder: 0, rationale: 'r', notes: { overview: 'NARRATIVEOVERVIEWMARKER', lines: [] } }],
      } });
    });
    await page.route('**/api/ai/analysis/*/status**', async (route) => {
      await route.fulfill({ json: { status: 'completed', progressCompleted: 1, progressTotal: 1 } });
    });

    await page.goto('/');
    const firstFile = page.locator('.file-item').first();
    await expect(firstFile).toBeVisible();
    selectedFileId = (await firstFile.getAttribute('data-file-id')) ?? '';
    expect(selectedFileId).not.toBe('');

    await firstFile.click();
    await expect(page.locator('#diff-container .diff-header').first()).toBeVisible();

    const riskNote = page.locator('.ai-note-overview.ai-note-risk');
    const narrativeNote = page.locator('.ai-note-overview.ai-note-narrative');

    // Normalize to folder mode (the persisted sort mode may be anything) — no
    // sort-mode overview notes should show. Guided-review notes, if enabled in
    // the ambient config, are a different class and are ignored throughout.
    await page.locator('[data-sort-mode="folder"]').click();
    await expect(riskNote).toHaveCount(0);
    await expect(narrativeNote).toHaveCount(0);

    // Switch to risk → the risk overview renders reactively. Before the fix this
    // stayed empty until a split/unified toggle forced a diff refetch.
    await page.locator('[data-sort-mode="risk"]').click();
    await expect(riskNote).toHaveCount(1, { timeout: 8000 });
    await expect(riskNote).toContainText('RISKOVERVIEWMARKER');

    // Switch to narrative → the stale risk note is cleared and the narrative
    // note appears, again with no diff refetch.
    await page.locator('[data-sort-mode="narrative"]').click();
    await expect(narrativeNote).toContainText('NARRATIVEOVERVIEWMARKER', { timeout: 8000 });
    await expect(riskNote).toHaveCount(0);

    // Back to folder → the sort-mode overview notes clear.
    await page.locator('[data-sort-mode="folder"]').click();
    await expect(riskNote).toHaveCount(0);
    await expect(narrativeNote).toHaveCount(0);
  });
});
