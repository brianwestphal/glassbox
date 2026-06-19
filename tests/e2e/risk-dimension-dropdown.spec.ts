/**
 * Regression coverage for the risk-dimension dropdown — the displayed
 * selection must follow `aiStore.state.value.riskSortDimension` across:
 *   1. Initial load (persisted dimension from server prefs).
 *   2. User picks a different option in the dropdown.
 *   3. Sort-mode switch (risk → narrative → risk).
 *
 * The JSX in `sortControl.tsx` emits `<option selected={value === ai.riskSortDimension}>`,
 * and that attribute alone drives the displayed value — there is no
 * imperative `bindSelectSync()` fallback in `sidebar/index.tsx`. If a future
 * kerf upgrade changes morph semantics for `<option selected>` in a way that
 * stops propagating the attribute to the live `<select>`, these tests catch
 * it. See GB-785 history.
 */
import { test, expect } from '@playwright/test';

const RISK_SCORES = [
  { reviewFileId: 'f-src/app.ts',  filePath: 'src/app.ts',  aggregateScore: 0.8, dimensionScores: { aggregate: 0.8, security: 0.9, correctness: 0.6, 'error-handling': 0.4, maintainability: 0.5, architecture: 0.7, performance: 0.3 }, rationale: 'mock', sortOrder: 0 },
  { reviewFileId: 'f-src/server.ts', filePath: 'src/server.ts', aggregateScore: 0.5, dimensionScores: { aggregate: 0.5, security: 0.3, correctness: 0.7, 'error-handling': 0.6, maintainability: 0.8, architecture: 0.4, performance: 0.5 }, rationale: 'mock', sortOrder: 1 },
];

test.describe('GB-785: risk-dimension dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/ai/preferences**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { sort_mode: 'risk', risk_sort_dimension: 'aggregate', show_risk_scores: true, ignore_whitespace: false, svg_view_mode: 'code', last_image_mode: 'metadata' } });
      } else {
        await route.fulfill({ json: { ok: true } });
      }
    });
    await page.route('**/api/ai/config**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { platform: 'anthropic', model: 'claude-opus-4-7', keyConfigured: true, keySource: 'env', localEndpoint: 'http://localhost:11434/v1', guidedReview: { enabled: false, topics: [] }, fallbackPlatform: null, fallbackModel: null } });
      } else {
        await route.fulfill({ json: { ok: true } });
      }
    });
    await page.route('**/api/ai/analysis/risk**', async (route) => {
      await route.fulfill({ json: { status: 'complete', progressCompleted: 0, progressTotal: 0, scores: RISK_SCORES, generatedAt: Date.now() } });
    });
    await page.route('**/api/ai/analysis/narrative**', async (route) => {
      await route.fulfill({ json: { status: 'complete', progressCompleted: 0, progressTotal: 0, scores: [], generatedAt: Date.now() } });
    });
  });

  test('initial load shows persisted dimension as selected', async ({ page }) => {
    await page.goto('/');
    const select = page.locator('.sort-dimension-select');
    await expect(select).toBeVisible({ timeout: 5000 });
    // Persisted dimension is 'aggregate' per the mocked GET /ai/preferences.
    await expect(select).toHaveValue('aggregate');
  });

  test('changing dimension updates the displayed selection', async ({ page }) => {
    await page.goto('/');
    const select = page.locator('.sort-dimension-select');
    await expect(select).toBeVisible({ timeout: 5000 });
    await expect(select).toHaveValue('aggregate');

    // User picks Security. The browser updates select.value natively + fires
    // change → store update → mount re-render → morph applies new `selected`.
    await select.selectOption('security');
    await expect(select).toHaveValue('security');

    // Pick another to make sure consecutive changes also stick.
    await select.selectOption('performance');
    await expect(select).toHaveValue('performance');
  });

  test('JSX `selected` attribute is set on the right option after a store change', async ({ page }) => {
    // This is the load-bearing test: even without bindSelectSync's imperative
    // poke, does the JSX `selected={...}` attribute end up on the right
    // option after morph completes?
    await page.goto('/');
    const select = page.locator('.sort-dimension-select');
    await expect(select).toBeVisible({ timeout: 5000 });

    // Switch dimension.
    await select.selectOption('correctness');
    await expect(select).toHaveValue('correctness');

    // Inspect the live DOM to confirm `<option selected>` is on the right one.
    const selectedValue = await page.evaluate(() => {
      const sel = document.querySelector<HTMLSelectElement>('.sort-dimension-select');
      const selectedOption = sel?.querySelector<HTMLOptionElement>('option[selected]');
      return selectedOption?.value ?? null;
    });
    expect(selectedValue).toBe('correctness');
  });

  test('sort-mode switch (risk → narrative → risk) preserves the dimension', async ({ page }) => {
    await page.goto('/');
    const select = page.locator('.sort-dimension-select');
    await expect(select).toBeVisible({ timeout: 5000 });

    await select.selectOption('maintainability');
    await expect(select).toHaveValue('maintainability');

    // Switch to narrative (dimension select goes display:none)
    await page.locator('[data-sort-mode="narrative"]').click();
    await expect(select).toBeHidden();

    // Back to risk
    await page.locator('[data-sort-mode="risk"]').click();
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('maintainability');
  });
});
