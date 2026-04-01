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
    model: 'claude-sonnet-4-20250514',
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
        model: 'claude-sonnet-4-20250514',
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
    expect(body.error).toBe('Invalid analysis type');
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
});
