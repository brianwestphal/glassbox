/**
 * Orchestrator-level sequence tests for the background analysis pipeline
 * (GB-1089): the `canceledAnalyses` Set lifecycle, the failure `finally`
 * cleanup, and cache carry-forward — previously only the components around
 * `executeAnalysis` were tested in isolation, so the transitions between them
 * (cancel → rerun, throw → rerun, cached → invalidate) were never driven.
 *
 * Runs the REAL pipeline (planner, batch runner, ai-queries, PGLite test DB)
 * with `setAIServiceTest(true)` so batches use the deterministic mock AI.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/db/connection.js', () => ({
  getDb: vi.fn(),
}));

// Instant deterministic batch results — the real mock module sleeps 2-4s per
// batch to simulate model latency, which is noise here.
vi.mock('../../../src/ai/mock.js', () => {
  const scores = { security: 3, correctness: 3, 'error-handling': 3, maintainability: 3, architecture: 3, performance: 3 };
  return {
    mockRiskAnalysisBatch: (files: { file_path: string }[]) =>
      Promise.resolve(files.map((f) => ({ filePath: f.file_path, scores, aggregate: 3, rationale: 'mock', notes: null }))),
    mockNarrativeAnalysisBatch: (files: { file_path: string }[]) =>
      Promise.resolve(files.map((f, i) => ({ filePath: f.file_path, position: i, rationale: 'mock', notes: null }))),
    mockGuidedAnalysisBatch: (files: { file_path: string }[]) =>
      Promise.resolve(files.map((f) => ({ filePath: f.file_path, notes: { summary: 'mock' } }))),
  };
});

// Failure injection for the pipeline-level throw path (the `finally` cleanup):
// updateAnalysisProgress runs inside executeAnalysis's try, outside the
// per-batch error handling.
const injected = vi.hoisted(() => ({ failProgress: false }));
vi.mock('../../../src/db/ai-queries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/db/ai-queries.js')>();
  return {
    ...actual,
    updateAnalysisProgress: async (...args: Parameters<typeof actual.updateAnalysisProgress>) => {
      if (injected.failProgress) throw new Error('injected progress failure');
      return actual.updateAnalysisProgress(...args);
    },
  };
});

import { executeAnalysis, markAnalysisCanceled } from '../../../src/ai/analysis-pipeline.js';
import { getDb } from '../../../src/db/connection.js';
import type { AIConfig } from '../../../src/ai/config.js';
import { createAnalysis, getFileScores, getLatestAnalysis } from '../../../src/db/ai-queries.js';
import { addReviewFile, createReview } from '../../../src/db/queries.js';
import { setAIServiceTest } from '../../../src/debug.js';
import { setupTestDb, teardownTestDb } from '../../helpers/db.js';

const CONFIG: AIConfig = { platform: 'anthropic', model: 'claude-sonnet-5', apiKey: 'test', keySource: 'config' };

function diffJson(path: string, content: string): string {
  return JSON.stringify({
    filePath: path,
    oldPath: null,
    status: 'modified',
    hunks: [{
      oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
      lines: [{ type: 'add', oldNum: null, newNum: 1, content }],
    }],
    isBinary: false,
  });
}

async function seedReview(tag: string) {
  const review = await createReview(`/repo/pipeline-${tag}`, `pipeline-${tag}`, 'uncommitted');
  const files = [];
  for (const name of ['a.ts', 'b.ts', 'c.ts']) {
    files.push(await addReviewFile(review.id, `src/${name}`, diffJson(`src/${name}`, `const x = '${name}';`)));
  }
  return { review, files };
}

function runInput(analysisId: string, reviewId: string, files: Awaited<ReturnType<typeof seedReview>>['files'], invalidateCache = false) {
  return {
    analysisId,
    analysisType: 'risk' as const,
    reviewId,
    files,
    config: CONFIG,
    repoRoot: '/tmp',
    guidedReview: { enabled: false, topics: [] },
    invalidateCache,
  };
}

beforeAll(async () => {
  const db = await setupTestDb();
  vi.mocked(getDb).mockResolvedValue(db);
  setAIServiceTest(true);
});
afterAll(async () => {
  setAIServiceTest(false);
  await teardownTestDb();
});

describe('executeAnalysis sequences (GB-1089)', () => {
  it('happy path: completes and scores every file', async () => {
    const { review, files } = await seedReview('happy');
    const analysis = await createAnalysis(review.id, 'risk');
    await executeAnalysis(runInput(analysis.id, review.id, files));

    const row = await getLatestAnalysis(review.id, 'risk');
    expect(row?.status).toBe('completed');
    expect((await getFileScores(analysis.id)).length).toBe(3);
  });

  it('cancel → failed:Canceled with the set cleaned; a rerun is NOT falsely canceled', async () => {
    const { review, files } = await seedReview('cancel');
    const a = await createAnalysis(review.id, 'risk');
    markAnalysisCanceled(a.id);
    await executeAnalysis(runInput(a.id, review.id, files));

    let row = await getLatestAnalysis(review.id, 'risk');
    expect(row?.status).toBe('failed');
    expect(row?.error_message).toBe('Canceled');

    // Rerunning the SAME analysis id must succeed — the success/cancel paths
    // both delete the id from the set, so no stale marker lingers.
    await executeAnalysis(runInput(a.id, review.id, files));
    row = await getLatestAnalysis(review.id, 'risk');
    expect(row?.status).toBe('completed');
    expect((await getFileScores(a.id)).length).toBeGreaterThanOrEqual(3);
  });

  it('canceling one id does not cancel a different analysis of the same review', async () => {
    const { review, files } = await seedReview('other-id');
    markAnalysisCanceled('some-other-analysis');
    const b = await createAnalysis(review.id, 'risk');
    await executeAnalysis(runInput(b.id, review.id, files));
    expect((await getLatestAnalysis(review.id, 'risk'))?.status).toBe('completed');
  });

  it('a mid-run throw cleans the cancel marker via finally, so a rerun succeeds', async () => {
    const { review, files } = await seedReview('throw');
    const c = await createAnalysis(review.id, 'risk');
    markAnalysisCanceled(c.id);
    injected.failProgress = true;
    try {
      await executeAnalysis(runInput(c.id, review.id, files));
    } finally {
      injected.failProgress = false;
    }

    let row = await getLatestAnalysis(review.id, 'risk');
    expect(row?.status).toBe('failed');
    // The throw happened before the cancel check — the message is the injected
    // error, not 'Canceled'.
    expect(row?.error_message).toBe('injected progress failure');

    // Rerun the same id: if `finally` had NOT cleaned the set, this run would
    // end failed:'Canceled' despite never being canceled.
    await executeAnalysis(runInput(c.id, review.id, files));
    row = await getLatestAnalysis(review.id, 'risk');
    expect(row?.status).toBe('completed');
  });

  it('a second run carries scores forward from cache; invalidateCache re-analyzes', async () => {
    const { review, files } = await seedReview('cache');
    const first = await createAnalysis(review.id, 'risk');
    await executeAnalysis(runInput(first.id, review.id, files));
    expect((await getFileScores(first.id)).length).toBe(3);

    // Cached rerun: every file carries forward, no batches run, progress
    // reflects the fully-cached total.
    const second = await createAnalysis(review.id, 'risk');
    await executeAnalysis(runInput(second.id, review.id, files));
    const secondRow = await getLatestAnalysis(review.id, 'risk');
    expect(secondRow?.status).toBe('completed');
    expect((await getFileScores(second.id)).length).toBe(3);
    expect(secondRow?.progress_completed).toBe(3);

    // Invalidate: the cache is discarded and a fresh run still scores all files.
    const third = await createAnalysis(review.id, 'risk');
    await executeAnalysis(runInput(third.id, review.id, files, true));
    expect((await getLatestAnalysis(review.id, 'risk'))?.status).toBe('completed');
    expect((await getFileScores(third.id)).length).toBe(3);
  });
});
