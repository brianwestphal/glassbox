/**
 * Integration tests for the AI API routes in src/routes/ai-api.ts.
 */
import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../../src/types.js';
import { SCHEMA_CORE_SQL, SCHEMA_AI_SQL } from '../../../src/db/schema.js';

let testDb: PGlite;
const TEST_REVIEW_ID = 'ai-test-review-001';
const TEST_REPO_ROOT = '/tmp/test-repo';
const TEST_FILE_ID = 'ai-test-file-001';

// Mock database connection
vi.mock('../../../src/db/connection.js', () => ({
  getDb: async () => testDb,
}));

// Mock AI config to avoid filesystem/keychain access
vi.mock('../../../src/ai/config.js', () => ({
  loadAIConfig: vi.fn(() => ({
    platform: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: null,
    keySource: null,
  })),
  saveAIConfigPreferences: vi.fn(),
  resolveAPIKey: vi.fn((_platform: string) => ({ key: null, source: null })),
  detectAvailablePlatforms: vi.fn(() => []),
  isKeychainAvailable: vi.fn(() => true),
  getKeychainLabel: vi.fn(() => 'Keychain'),
  saveAPIKey: vi.fn(),
  deleteAPIKey: vi.fn(),
  loadGuidedReviewConfig: vi.fn(() => ({ enabled: false, topics: [] })),
  saveGuidedReviewConfig: vi.fn(),
}));

// Mock debug module
vi.mock('../../../src/debug.js', () => ({
  debugLog: vi.fn(),
  isDebug: vi.fn(() => false),
  isAIServiceTest: vi.fn(() => false),
  getDemoMode: vi.fn(() => null),
}));

// Mock AI analysis modules (not testing actual analysis here)
vi.mock('../../../src/ai/analyze-risk.js', () => ({ runRiskAnalysisBatch: vi.fn() }));
vi.mock('../../../src/ai/analyze-narrative.js', () => ({ runNarrativeAnalysisBatch: vi.fn(), mergeNarrativeOrders: vi.fn() }));
vi.mock('../../../src/ai/analyze-guided.js', () => ({ runGuidedAnalysisBatch: vi.fn() }));
vi.mock('../../../src/ai/mock.js', () => ({
  mockRiskAnalysisBatch: vi.fn(),
  mockNarrativeAnalysisBatch: vi.fn(),
  mockGuidedAnalysisBatch: vi.fn(),
}));

// Mock batch planner and runner (not testing actual batch processing)
vi.mock('../../../src/ai/batch-planner.js', () => ({
  planBatches: vi.fn(() => ({ batches: [], binaryFiles: [] })),
}));
vi.mock('../../../src/ai/batch-runner.js', () => ({
  runBatches: vi.fn(async () => []),
}));

import { aiApiRoutes } from '../../../src/routes/ai-api.js';

function createTestApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('reviewId', TEST_REVIEW_ID);
    c.set('currentReviewId', TEST_REVIEW_ID);
    c.set('repoRoot', TEST_REPO_ROOT);
    await next();
  });
  app.route('/api/ai', aiApiRoutes);
  return app;
}

let app: Hono<AppEnv>;

beforeAll(async () => {
  testDb = new PGlite();
  await testDb.waitReady;
  await testDb.exec(SCHEMA_CORE_SQL);
  await testDb.exec(SCHEMA_AI_SQL);

  // Seed a review and file
  await testDb.query(
    `INSERT INTO reviews (id, repo_path, repo_name, mode, status) VALUES ($1, $2, $3, $4, $5)`,
    [TEST_REVIEW_ID, TEST_REPO_ROOT, 'test-repo', 'uncommitted', 'in_progress'],
  );
  await testDb.query(
    `INSERT INTO review_files (id, review_id, file_path, diff_data, status) VALUES ($1, $2, $3, $4, $5)`,
    [TEST_FILE_ID, TEST_REVIEW_ID, 'src/app.ts', '{"hunks":[],"status":"modified"}', 'pending'],
  );

  app = createTestApp();
});

afterAll(async () => {
  if (testDb) await testDb.close();
});

// --- Configuration ---

describe('GET /api/ai/config', () => {
  it('returns the current AI configuration', async () => {
    const res = await app.request('/api/ai/config');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platform).toBe('anthropic');
    expect(body.model).toBeDefined();
    expect(typeof body.keyConfigured).toBe('boolean');
    expect(body.guidedReview).toBeDefined();
  });
});

describe('POST /api/ai/config', () => {
  it('saves platform and model preferences', async () => {
    const res = await app.request('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'openai', model: 'gpt-4o' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('saves guided review config when provided', async () => {
    const { saveGuidedReviewConfig } = await import('../../../src/ai/config.js');
    const res = await app.request('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'anthropic',
        model: 'claude-sonnet-4-6',
        guidedReview: { enabled: true, topics: ['typescript'] },
      }),
    });
    expect(res.status).toBe(200);
    expect(saveGuidedReviewConfig).toHaveBeenCalledWith({ enabled: true, topics: ['typescript'] });
  });
});

describe('GET /api/ai/models', () => {
  it('returns platforms and models', async () => {
    const res = await app.request('/api/ai/models');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platforms).toBeDefined();
    expect(body.models).toBeDefined();
    expect(body.models.anthropic).toBeDefined();
    expect(body.models.openai).toBeDefined();
    expect(body.models.google).toBeDefined();
  });
});

describe('GET /api/ai/key-status', () => {
  it('returns key status for all platforms', async () => {
    const res = await app.request('/api/ai/key-status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status.anthropic).toBeDefined();
    expect(body.status.openai).toBeDefined();
    expect(body.status.google).toBeDefined();
    expect(typeof body.keychainAvailable).toBe('boolean');
    expect(typeof body.keychainLabel).toBe('string');
    expect(Array.isArray(body.availablePlatforms)).toBe(true);
  });
});

describe('POST /api/ai/key', () => {
  it('saves an API key', async () => {
    const { saveAPIKey } = await import('../../../src/ai/config.js');
    const res = await app.request('/api/ai/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'anthropic', key: 'sk-test', storage: 'config' }),
    });
    expect(res.status).toBe(200);
    expect(saveAPIKey).toHaveBeenCalledWith('anthropic', 'sk-test', 'config');
  });
});

describe('DELETE /api/ai/key', () => {
  it('deletes an API key', async () => {
    const { deleteAPIKey } = await import('../../../src/ai/config.js');
    const res = await app.request('/api/ai/key?platform=openai', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(deleteAPIKey).toHaveBeenCalledWith('openai');
  });
});

// --- Analysis ---

describe('POST /api/ai/analyze', () => {
  it('returns 400 for invalid analysis type', async () => {
    const res = await app.request(`/api/ai/analyze?reviewId=${TEST_REVIEW_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'invalid' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    // zod produces a path-qualified error message; we accept any error
    // string here as long as the status is 400 and the field is mentioned.
    expect(body.error).toMatch(/type/);
  });

  it('returns 400 when no API key configured', async () => {
    const res = await app.request(`/api/ai/analyze?reviewId=${TEST_REVIEW_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'risk' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No API key configured');
  });
});

describe('GET /api/ai/analysis/:type', () => {
  it('returns none status when no analysis exists', async () => {
    const res = await app.request(`/api/ai/analysis/risk?reviewId=${TEST_REVIEW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('none');
    expect(body.scores).toEqual([]);
  });
});

describe('GET /api/ai/analysis/:type/status', () => {
  it('returns none status when no analysis exists', async () => {
    const res = await app.request(`/api/ai/analysis/risk/status?reviewId=${TEST_REVIEW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('none');
  });
});

// --- Debug ---

describe('GET /api/ai/debug-status', () => {
  it('returns debug status', async () => {
    const res = await app.request('/api/ai/debug-status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.enabled).toBe('boolean');
  });
});

describe('POST /api/ai/debug-log', () => {
  it('returns ok', async () => {
    const res = await app.request('/api/ai/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test log' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// --- Preferences ---

describe('GET /api/ai/preferences', () => {
  it('returns user preferences', async () => {
    const res = await app.request('/api/ai/preferences');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
  });
});

describe('POST /api/ai/preferences', () => {
  it('saves user preferences', async () => {
    const res = await app.request('/api/ai/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_mode: 'risk', show_risk_scores: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify the preference was saved
    const getRes = await app.request('/api/ai/preferences');
    const prefs = await getRes.json();
    expect(prefs.sort_mode).toBe('risk');
    expect(prefs.show_risk_scores).toBe(true);
  });

  it('saves additional preference fields', async () => {
    const res = await app.request('/api/ai/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ignore_whitespace: true,
        svg_view_mode: 'rendered',
        last_image_mode: 'difference',
      }),
    });
    expect(res.status).toBe(200);

    const getRes = await app.request('/api/ai/preferences');
    const prefs = await getRes.json();
    expect(prefs.ignore_whitespace).toBe(true);
    expect(prefs.svg_view_mode).toBe('rendered');
    expect(prefs.last_image_mode).toBe('difference');
  });

  it('preserves previously set preferences when updating other fields', async () => {
    // Set sort_mode
    await app.request('/api/ai/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_mode: 'narrative' }),
    });

    // Set a different field
    await app.request('/api/ai/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_risk_scores: false }),
    });

    // Verify sort_mode is still narrative
    const getRes = await app.request('/api/ai/preferences');
    const prefs = await getRes.json();
    expect(prefs.sort_mode).toBe('narrative');
    expect(prefs.show_risk_scores).toBe(false);
  });

  it('saves risk_sort_dimension preference', async () => {
    const res = await app.request('/api/ai/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ risk_sort_dimension: 'security' }),
    });
    expect(res.status).toBe(200);

    const getRes = await app.request('/api/ai/preferences');
    const prefs = await getRes.json();
    expect(prefs.risk_sort_dimension).toBe('security');
  });
});

// --- Analysis with data ---

describe('POST /api/ai/analyze (additional cases)', () => {
  it('returns 400 when no files exist for the review', async () => {
    // Create a review with no files
    const emptyReviewId = 'empty-review-001';
    await testDb.query(
      `INSERT INTO reviews (id, repo_path, repo_name, mode, status) VALUES ($1, $2, $3, $4, $5)`,
      [emptyReviewId, TEST_REPO_ROOT, 'test-repo', 'uncommitted', 'in_progress'],
    );

    // Use a separate app that sets reviewId to the empty review
    // But the analyze endpoint reads reviewId from query param
    const { loadAIConfig } = await import('../../../src/ai/config.js');
    vi.mocked(loadAIConfig).mockReturnValue({
      platform: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-test-key',
      keySource: 'config',
    });

    const res = await app.request(`/api/ai/analyze?reviewId=${emptyReviewId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'risk' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No files in review');

    // Restore the mock
    vi.mocked(loadAIConfig).mockReturnValue({
      platform: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: null,
      keySource: null,
    });

    // Clean up
    await testDb.query('DELETE FROM reviews WHERE id = $1', [emptyReviewId]);
  });

  it('returns 400 for guided analysis type', async () => {
    // With no API key, should still fail with "No API key configured"
    const res = await app.request(`/api/ai/analyze?reviewId=${TEST_REVIEW_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'guided' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No API key configured');
  });

  it('returns 400 for narrative analysis type without API key', async () => {
    const res = await app.request(`/api/ai/analyze?reviewId=${TEST_REVIEW_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'narrative' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No API key configured');
  });

  it('starts analysis when API key is configured', async () => {
    const { loadAIConfig } = await import('../../../src/ai/config.js');
    vi.mocked(loadAIConfig).mockReturnValue({
      platform: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-test-key',
      keySource: 'config',
    });

    const res = await app.request(`/api/ai/analyze?reviewId=${TEST_REVIEW_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'risk' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysisId).toBeDefined();
    expect(body.status).toBe('running');

    // Restore
    vi.mocked(loadAIConfig).mockReturnValue({
      platform: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: null,
      keySource: null,
    });
  });

  it('deduplicates running analyses of the same type', async () => {
    const { loadAIConfig } = await import('../../../src/ai/config.js');
    vi.mocked(loadAIConfig).mockReturnValue({
      platform: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-test-key',
      keySource: 'config',
    });

    // Start a risk analysis
    const res1 = await app.request(`/api/ai/analyze?reviewId=${TEST_REVIEW_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'risk' }),
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    // Start another risk analysis — should reuse the existing one
    const res2 = await app.request(`/api/ai/analyze?reviewId=${TEST_REVIEW_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'risk' }),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.analysisId).toBe(body1.analysisId);
    expect(body2.status).toBe('running');

    // Restore
    vi.mocked(loadAIConfig).mockReturnValue({
      platform: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: null,
      keySource: null,
    });
  });
});

// --- Analysis retrieval with data ---

describe('GET /api/ai/analysis/:type (with data)', () => {
  it('returns failed status with error message', async () => {
    // Insert a failed analysis directly
    const analysisId = 'failed-analysis-001';
    await testDb.query(
      `INSERT INTO ai_analyses (id, review_id, analysis_type, status, error_message)
       VALUES ($1, $2, $3, $4, $5)`,
      [analysisId, TEST_REVIEW_ID, 'narrative', 'failed', 'API rate limit exceeded'],
    );

    const res = await app.request(`/api/ai/analysis/narrative?reviewId=${TEST_REVIEW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error).toBe('API rate limit exceeded');
    expect(body.scores).toEqual([]);

    // Clean up
    await testDb.query('DELETE FROM ai_analyses WHERE id = $1', [analysisId]);
  });

  it('returns completed status with scores', async () => {
    // Insert a completed analysis with file scores
    const analysisId = 'completed-analysis-001';
    await testDb.query(
      `INSERT INTO ai_analyses (id, review_id, analysis_type, status, progress_completed, progress_total)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [analysisId, TEST_REVIEW_ID, 'risk', 'completed', 1, 1],
    );
    await testDb.query(
      `INSERT INTO ai_file_scores (id, analysis_id, review_file_id, file_path, sort_order, aggregate_score, rationale, dimension_scores, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        'score-001', analysisId, TEST_FILE_ID, 'src/app.ts', 0, 75,
        'High risk due to complexity',
        JSON.stringify({ security: 80, correctness: 70, 'error-handling': 60, maintainability: 50, architecture: 40, performance: 30 }),
        JSON.stringify({ overview: 'Complex file', lines: [{ line: 10, content: 'Check this' }] }),
      ],
    );

    const res = await app.request(`/api/ai/analysis/risk?reviewId=${TEST_REVIEW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('completed');
    expect(body.scores.length).toBe(1);
    expect(body.scores[0].filePath).toBe('src/app.ts');
    expect(body.scores[0].aggregateScore).toBe(75);
    expect(body.scores[0].rationale).toBe('High risk due to complexity');
    expect(body.scores[0].dimensionScores.security).toBe(80);
    expect(body.scores[0].notes.overview).toBe('Complex file');
    expect(body.scores[0].notes.lines[0].line).toBe(10);

    // Clean up
    await testDb.query('DELETE FROM ai_file_scores WHERE analysis_id = $1', [analysisId]);
    await testDb.query('DELETE FROM ai_analyses WHERE id = $1', [analysisId]);
  });

  it('returns running status with partial scores and progress', async () => {
    // Insert a running analysis with some scores
    const analysisId = 'running-analysis-001';
    await testDb.query(
      `INSERT INTO ai_analyses (id, review_id, analysis_type, status, progress_completed, progress_total)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [analysisId, TEST_REVIEW_ID, 'risk', 'running', 1, 3],
    );
    await testDb.query(
      `INSERT INTO ai_file_scores (id, analysis_id, review_file_id, file_path, sort_order, aggregate_score, rationale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['partial-score-001', analysisId, TEST_FILE_ID, 'src/app.ts', 0, 50, 'Partial result'],
    );

    const res = await app.request(`/api/ai/analysis/risk?reviewId=${TEST_REVIEW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('running');
    expect(body.progressCompleted).toBe(1);
    expect(body.progressTotal).toBe(3);
    expect(body.scores.length).toBe(1);

    // Clean up
    await testDb.query('DELETE FROM ai_file_scores WHERE analysis_id = $1', [analysisId]);
    await testDb.query('DELETE FROM ai_analyses WHERE id = $1', [analysisId]);
  });
});

describe('GET /api/ai/analysis/:type/status (with data)', () => {
  it('returns running status with progress info', async () => {
    const analysisId = 'status-running-001';
    await testDb.query(
      `INSERT INTO ai_analyses (id, review_id, analysis_type, status, progress_completed, progress_total)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [analysisId, TEST_REVIEW_ID, 'risk', 'running', 5, 10],
    );

    const res = await app.request(`/api/ai/analysis/risk/status?reviewId=${TEST_REVIEW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('running');
    expect(body.progressCompleted).toBe(5);
    expect(body.progressTotal).toBe(10);

    // Clean up
    await testDb.query('DELETE FROM ai_analyses WHERE id = $1', [analysisId]);
  });

  it('returns completed status', async () => {
    const analysisId = 'status-completed-001';
    await testDb.query(
      `INSERT INTO ai_analyses (id, review_id, analysis_type, status, progress_completed, progress_total)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [analysisId, TEST_REVIEW_ID, 'narrative', 'completed', 5, 5],
    );

    const res = await app.request(`/api/ai/analysis/narrative/status?reviewId=${TEST_REVIEW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('completed');
    expect(body.progressCompleted).toBe(5);
    expect(body.progressTotal).toBe(5);

    // Clean up
    await testDb.query('DELETE FROM ai_analyses WHERE id = $1', [analysisId]);
  });

  it('returns failed status with error message', async () => {
    const analysisId = 'status-failed-001';
    await testDb.query(
      `INSERT INTO ai_analyses (id, review_id, analysis_type, status, error_message)
       VALUES ($1, $2, $3, $4, $5)`,
      [analysisId, TEST_REVIEW_ID, 'risk', 'failed', 'Connection timeout'],
    );

    const res = await app.request(`/api/ai/analysis/risk/status?reviewId=${TEST_REVIEW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error).toBe('Connection timeout');

    // Clean up
    await testDb.query('DELETE FROM ai_analyses WHERE id = $1', [analysisId]);
  });

  it('auto-times out stale running analyses', async () => {
    const analysisId = 'status-stale-001';
    // Insert with updated_at set far in the past (> 15 minutes)
    await testDb.query(
      `INSERT INTO ai_analyses (id, review_id, analysis_type, status, progress_completed, progress_total, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [analysisId, TEST_REVIEW_ID, 'risk', 'running', 2, 10, '2020-01-01T00:00:00'],
    );

    const res = await app.request(`/api/ai/analysis/risk/status?reviewId=${TEST_REVIEW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error).toBe('Analysis timed out');

    // Verify the analysis was actually updated in the database
    const check = await testDb.query('SELECT status, error_message FROM ai_analyses WHERE id = $1', [analysisId]);
    expect(check.rows[0].status).toBe('failed');
    expect(check.rows[0].error_message).toBe('Analysis timed out');

    // Clean up
    await testDb.query('DELETE FROM ai_analyses WHERE id = $1', [analysisId]);
  });
});

// --- Configuration edge cases ---

describe('POST /api/ai/config (edge cases)', () => {
  it('does not call saveGuidedReviewConfig when guidedReview is not provided', async () => {
    const { saveGuidedReviewConfig } = await import('../../../src/ai/config.js');
    vi.mocked(saveGuidedReviewConfig).mockClear();

    const res = await app.request('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'google', model: 'gemini-2.5-pro' }),
    });
    expect(res.status).toBe(200);
    expect(saveGuidedReviewConfig).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/ai/key (edge cases)', () => {
  it('defaults to anthropic when no platform query param is provided', async () => {
    const { deleteAPIKey } = await import('../../../src/ai/config.js');
    vi.mocked(deleteAPIKey).mockClear();

    const res = await app.request('/api/ai/key', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(deleteAPIKey).toHaveBeenCalledWith('anthropic');
  });

  it('deletes key for google platform', async () => {
    const { deleteAPIKey } = await import('../../../src/ai/config.js');
    vi.mocked(deleteAPIKey).mockClear();

    const res = await app.request('/api/ai/key?platform=google', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(deleteAPIKey).toHaveBeenCalledWith('google');
  });
});

// --- Analysis for different types ---

describe('GET /api/ai/analysis/narrative', () => {
  it('returns none status when no narrative analysis exists', async () => {
    // Clean up any leftover analyses first
    await testDb.query(
      `DELETE FROM ai_analyses WHERE review_id = $1 AND analysis_type = $2`,
      [TEST_REVIEW_ID, 'narrative'],
    );

    const res = await app.request(`/api/ai/analysis/narrative?reviewId=${TEST_REVIEW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('none');
    expect(body.scores).toEqual([]);
  });
});

describe('GET /api/ai/analysis/guided', () => {
  it('returns none status when no guided analysis exists', async () => {
    const res = await app.request(`/api/ai/analysis/guided?reviewId=${TEST_REVIEW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('none');
    expect(body.scores).toEqual([]);
  });
});

describe('GET /api/ai/analysis/guided/status', () => {
  it('returns none status when no guided analysis exists', async () => {
    const res = await app.request(`/api/ai/analysis/guided/status?reviewId=${TEST_REVIEW_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('none');
  });
});
