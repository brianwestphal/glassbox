import { Hono } from 'hono';
import { z } from 'zod';

import type { GuidedFileResult } from '../ai/analyze-guided.js';
import { runGuidedAnalysisBatch } from '../ai/analyze-guided.js';
import type { NarrativeFileResult } from '../ai/analyze-narrative.js';
import { mergeNarrativeOrders, runNarrativeAnalysisBatch } from '../ai/analyze-narrative.js';
import type { RiskFileResult } from '../ai/analyze-risk.js';
import { runRiskAnalysisBatch } from '../ai/analyze-risk.js';
import { planBatches } from '../ai/batch-planner.js';
import { runBatches } from '../ai/batch-runner.js';
import type { AIConfig, GuidedReviewConfig } from '../ai/config.js';
import { loadAIConfig, loadGuidedReviewConfig } from '../ai/config.js';
import { mockGuidedAnalysisBatch, mockNarrativeAnalysisBatch, mockRiskAnalysisBatch } from '../ai/mock.js';
import { getModelContextWindow, KEYLESS_PLATFORMS } from '../ai/models.js';
import {
  AnalysisTypeSchema,
  SaveAIPreferencesReqSchema,
  StartAnalysisReqSchema,
} from '../api/index.js';
import {
  appendFileScores,
  createAnalysis,
  getFileScoresForReview,
  getLatestAnalysis,
  getPreviousScores,
  getUserPreferences,
  saveUserPreferences,
  updateAnalysisProgress,
  updateAnalysisStatus,
} from '../db/ai-queries.js';
import { getDb } from '../db/connection.js';
import type { ReviewFile } from '../db/queries.js';
import { getReviewFiles } from '../db/queries.js';
import { DimensionScoresSchema, FileScoreNotesSchema, parseJsonColumn } from '../db/schemas.js';
import { debugLog, isAIServiceTest, isDebug } from '../debug.js';
import type { AppEnv } from '../types.js';
import { errorResponse, parseBody } from '../utils/parseBody.js';
import { resolveReviewId } from '../utils/resolveReviewId.js';

export const aiAnalysisRoutes = new Hono<AppEnv>();

/** How long a still-`running` analysis row is reused before it's treated as
 *  stale (the worker presumably died) and a fresh run is started. */
const ANALYSIS_REUSE_TIMEOUT_MS = 15 * 60 * 1000;

/** Parse the `updated_at` timestamp on an analysis row. PGLite returns
 *  raw `TIMESTAMP` columns in the server's local time; the previous
 *  implementation appended `Z` to coerce them to UTC. The DB-row schema
 *  now normalizes either a `Date` or a string via `toISOString()`, so
 *  the value is already a valid ISO-with-Z when it reaches us. For
 *  legacy bare-naive strings without a trailing `Z` (still used as test
 *  fixtures), append the Z explicitly. */
function parseAnalysisTimestamp(updatedAt: string): Date {
  if (updatedAt.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(updatedAt)) {
    return new Date(updatedAt);
  }
  return new Date(updatedAt + 'Z');
}

/** Resolve a file path to its `review_file` id, failing loudly if the path
 *  isn't in the map. This should never happen (the map is built from the same
 *  file list), but a silent `?? ''` fallback would persist an empty
 *  `reviewFileId` and corrupt the saved scores — fail fast instead. */
function resolveFileId(fileIdMap: Map<string, string>, filePath: string): string {
  const id = fileIdMap.get(filePath);
  if (id === undefined || id === '') {
    throw new Error(`No review_file id for path: ${filePath}`);
  }
  return id;
}

// Track canceled analysis IDs — checked by batch runner before starting new batches.
// When a user switches from risk→narrative (or vice versa), the old analysis is added here.
// Switching to folder mode does NOT cancel anything.
const canceledAnalyses = new Set<string>();

// --- Analysis ---

aiAnalysisRoutes.post('/analyze', async (c) => {
  const reviewId = resolveReviewId(c);
  const repoRoot = c.get('repoRoot');
  const parsed = await parseBody(c, StartAnalysisReqSchema);
  if (!parsed.ok) return parsed.response;
  const analysisType = parsed.data.type;
  const invalidateCache = parsed.data.invalidateCache === true;

  debugLog(`POST /analyze: type=${analysisType}, reviewId=${reviewId}`);

  const testMode = isAIServiceTest();
  const config = loadAIConfig();
  // Keyless platforms (`local`, `apple`) have no API key by design, so a null
  // key is expected for them — gate only the key-based cloud platforms. Mirrors
  // the client's check (`client.ts`) and `GET /api/ai/config`'s keyConfigured.
  if (config.apiKey === null && !testMode && !KEYLESS_PLATFORMS.has(config.platform)) {
    debugLog('POST /analyze: no API key configured');
    return c.json({ error: 'No API key configured' }, 400);
  }

  debugLog(`POST /analyze: platform=${config.platform}, model=${config.model}${testMode ? ' (TEST MODE)' : ''}`);

  const files = await getReviewFiles(reviewId);
  debugLog(`POST /analyze: ${String(files.length)} files in review`);
  if (files.length === 0) {
    return c.json({ error: 'No files in review' }, 400);
  }

  // When invalidating cache, cancel running analyses of all types
  if (invalidateCache) {
    debugLog('POST /analyze: invalidateCache=true, canceling all running analyses');
    for (const type of ['risk', 'narrative', 'guided'] as const) {
      const running = await getLatestAnalysis(reviewId, type);
      if (running !== undefined && running.status === 'running') {
        debugLog(`POST /analyze: canceling ${type} analysis id=${running.id}`);
        canceledAnalyses.add(running.id);
        await updateAnalysisStatus(running.id, 'failed', 'Canceled');
      }
    }
  } else if (analysisType === 'risk' || analysisType === 'narrative') {
    // Risk↔narrative cancel each other; guided runs independently
    const otherType = analysisType === 'risk' ? 'narrative' : 'risk';
    const otherRunning = await getLatestAnalysis(reviewId, otherType);
    if (otherRunning !== undefined && otherRunning.status === 'running') {
      debugLog(`POST /analyze: canceling ${otherType} analysis id=${otherRunning.id} (switching to ${analysisType})`);
      canceledAnalyses.add(otherRunning.id);
    }
  }

  if (!invalidateCache) {
    // Deduplicate: if there's already a running analysis of this type, return it
    const existing = await getLatestAnalysis(reviewId, analysisType);
    if (existing !== undefined) {
      debugLog(`POST /analyze: found existing ${analysisType} analysis id=${existing.id}, status=${existing.status}, created=${existing.created_at}, updated=${existing.updated_at}`);
    }
    if (existing !== undefined && existing.status === 'running') {
      const ageMs = Date.now() - parseAnalysisTimestamp(existing.updated_at).getTime();
      debugLog(`POST /analyze: existing analysis age=${String(Math.round(ageMs / 1000))}s`);
      if (ageMs < ANALYSIS_REUSE_TIMEOUT_MS) {
        // Still recent, reuse it
        debugLog('POST /analyze: reusing existing running analysis');
        return c.json({ analysisId: existing.id, status: 'running' as const });
      }
      // Stale — mark it as failed so we can start fresh
      debugLog('POST /analyze: marking stale analysis as timed out');
      await updateAnalysisStatus(existing.id, 'failed', 'Analysis timed out');
    }
  }

  const analysis = await createAnalysis(reviewId, analysisType);
  debugLog(`POST /analyze: created new analysis id=${analysis.id}`);

  const guidedReview = loadGuidedReviewConfig();

  // Kick off the long-running work in the background — `void` is intentional
  // so the HTTP response returns immediately while batches stream results.
  // `executeAnalysis` already records failures on the analysis row via its own
  // try/catch; the trailing `.catch` is a belt-and-suspenders guard against the
  // failure-recording path *itself* throwing (e.g. a DB write error), so it can
  // never surface as an unhandled promise rejection.
  void executeAnalysis({
    analysisId: analysis.id,
    analysisType,
    reviewId,
    files,
    config,
    repoRoot,
    guidedReview,
    invalidateCache,
  }).catch((err: unknown) => {
    debugLog(`executeAnalysis dispatch rejected for ${analysis.id}: ${err instanceof Error ? err.message : String(err)}`);
  });

  return c.json({ analysisId: analysis.id, status: 'running' as const });
});

interface ExecuteAnalysisInput {
  analysisId: string;
  analysisType: 'risk' | 'narrative' | 'guided';
  reviewId: string;
  files: ReviewFile[];
  config: AIConfig;
  repoRoot: string;
  guidedReview: GuidedReviewConfig;
  invalidateCache: boolean;
}

/**
 * Run the full analysis pipeline for a single `analyses` row: cache
 * carry-forward, binary file scoring, batch dispatch, finalize, and
 * cancellation handling. Wraps the whole body in a try/catch so
 * background errors surface in the analysis row's status.
 */
async function executeAnalysis(input: ExecuteAnalysisInput): Promise<void> {
  const { analysisId, analysisType, reviewId, files, config, repoRoot, guidedReview, invalidateCache } = input;
  try {
    debugLog('Background analysis starting...');
    const contextWindow = getModelContextWindow(config.platform, config.model);
    debugLog(`Context window: ${String(contextWindow)} tokens`);
    const { batches, binaryFiles } = planBatches(files, contextWindow);
    const fileIdMap = new Map(files.map(f => [f.file_path, f.id]));

    debugLog(`Analysis plan: ${String(batches.reduce((s, b) => s + b.files.length, 0))} analyzable + ${String(binaryFiles.length)} binary in ${String(batches.length)} batch(es)`);

    const { cachedCount, filteredBatches } = await applyCachedScores({
      analysisId, analysisType, reviewId, fileIdMap, batches, binaryFiles, invalidateCache,
    });

    const filteredAnalyzable = filteredBatches.reduce((sum, b) => sum + b.files.length, 0);
    const totalForProgress = filteredAnalyzable + binaryFiles.length + cachedCount;
    debugLog(`After cache: ${String(filteredAnalyzable)} files to analyze in ${String(filteredBatches.length)} batch(es)`);

    await updateAnalysisProgress(analysisId, cachedCount, totalForProgress);

    await saveBinaryFiles({ analysisId, analysisType, fileIdMap, binaryFiles, cachedCount, totalForProgress });

    if (filteredBatches.length === 0) {
      debugLog('No batches to process (all files cached or binary), marking completed');
      await updateAnalysisStatus(analysisId, 'completed');
      return;
    }

    const progressOffset = cachedCount + binaryFiles.length;
    await dispatchByType({
      analysisType, analysisId, filteredBatches, files, totalForProgress, progressOffset,
      config, repoRoot, fileIdMap, guidedReview,
    });

    // Check if this analysis was canceled while running (user switched modes)
    if (canceledAnalyses.has(analysisId)) {
      canceledAnalyses.delete(analysisId);
      debugLog(`Analysis ${analysisId} was canceled (user switched modes)`);
      await updateAnalysisStatus(analysisId, 'failed', 'Canceled');
      return;
    }

    canceledAnalyses.delete(analysisId);
    debugLog(`Analysis ${analysisId} completed successfully`);
    await updateAnalysisStatus(analysisId, 'completed');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Analysis failed: ${message}`);
    debugLog(`Analysis ${analysisId} failed: ${message}`);
    await updateAnalysisStatus(analysisId, 'failed', message);
  }
}

/** Carry forward scores from a previous analysis of the same review.
 *  Returns the cached count + the batches with already-cached files removed. */
async function applyCachedScores(args: {
  analysisId: string;
  analysisType: 'risk' | 'narrative' | 'guided';
  reviewId: string;
  fileIdMap: Map<string, string>;
  batches: Array<{ files: ReviewFile[]; estimatedTokens: number }>;
  binaryFiles: ReviewFile[];
  invalidateCache: boolean;
}): Promise<{ cachedCount: number; filteredBatches: Array<{ files: ReviewFile[]; estimatedTokens: number }> }> {
  const { analysisId, analysisType, reviewId, fileIdMap, batches, binaryFiles, invalidateCache } = args;
  const prevScores = invalidateCache ? [] : await getPreviousScores(reviewId, analysisType, analysisId);
  const binaryPathSet = new Set(binaryFiles.map(f => f.file_path));
  const unchangedPaths = new Set<string>();
  const cachedScores = prevScores.filter(s => {
    // Only carry forward non-binary files that still exist in the review
    // (binary files are re-saved separately by `saveBinaryFiles`).
    if (fileIdMap.has(s.file_path) && !binaryPathSet.has(s.file_path)) {
      unchangedPaths.add(s.file_path);
      return true;
    }
    return false;
  });

  debugLog(`Cache: ${String(cachedScores.length)} scores carried forward from previous analysis`);

  if (cachedScores.length > 0) {
    const cachedForInsert = cachedScores.map(s => ({
      reviewFileId: fileIdMap.get(s.file_path) ?? s.review_file_id,
      filePath: s.file_path,
      sortOrder: s.sort_order,
      aggregateScore: s.aggregate_score,
      rationale: s.rationale,
      dimensionScores: parseJsonColumn(DimensionScoresSchema, s.dimension_scores),
      notes: parseJsonColumn(FileScoreNotesSchema, s.notes),
    }));
    await appendFileScores(analysisId, cachedForInsert);
  }

  const filteredBatches = batches
    .map(batch => ({
      files: batch.files.filter(f => !unchangedPaths.has(f.file_path)),
      estimatedTokens: batch.estimatedTokens,
    }))
    .filter(batch => batch.files.length > 0);

  return { cachedCount: cachedScores.length, filteredBatches };
}

/** Save binary (image/blob) files with a sentinel score so they appear in
 *  the sidebar but aren't sent to the model. */
async function saveBinaryFiles(args: {
  analysisId: string;
  analysisType: 'risk' | 'narrative' | 'guided';
  fileIdMap: Map<string, string>;
  binaryFiles: ReviewFile[];
  cachedCount: number;
  totalForProgress: number;
}): Promise<void> {
  const { analysisId, analysisType, fileIdMap, binaryFiles, cachedCount, totalForProgress } = args;
  if (binaryFiles.length === 0) return;
  debugLog(`Saving ${String(binaryFiles.length)} binary files with score 0`);
  const binaryScoreEntries = binaryFiles.map((f, idx) => ({
    reviewFileId: resolveFileId(fileIdMap, f.file_path),
    filePath: f.file_path,
    sortOrder: 99999 + idx, // re-sorted by `updateSortOrders` later
    aggregateScore: analysisType === 'risk' ? 0 : null,
    rationale: 'Binary file — not analyzed',
    dimensionScores: analysisType === 'risk'
      ? { security: 0, correctness: 0, 'error-handling': 0, maintainability: 0, architecture: 0, performance: 0 }
      : null,
    notes: null,
  }));
  await appendFileScores(analysisId, binaryScoreEntries);
  await updateAnalysisProgress(analysisId, cachedCount + binaryFiles.length, totalForProgress);
}

/** Pick the right `*AnalysisConfig` for the analysis type and run the
 *  batched analysis with it. */
async function dispatchByType(args: {
  analysisType: 'risk' | 'narrative' | 'guided';
  analysisId: string;
  filteredBatches: Array<{ files: ReviewFile[]; estimatedTokens: number }>;
  files: ReviewFile[];
  totalForProgress: number;
  progressOffset: number;
  config: AIConfig;
  repoRoot: string;
  fileIdMap: Map<string, string>;
  guidedReview: GuidedReviewConfig;
}): Promise<void> {
  const { analysisType, analysisId, filteredBatches, files, totalForProgress, progressOffset, config, repoRoot, fileIdMap, guidedReview } = args;
  const shouldCancel = () => canceledAnalyses.has(analysisId);
  const runArgs = [analysisId, filteredBatches, files.length, totalForProgress, progressOffset] as const;

  if (analysisType === 'risk') {
    await runBatchedAnalysis(...runArgs, riskAnalysisConfig(config, repoRoot, fileIdMap, guidedReview, analysisId), shouldCancel);
  } else if (analysisType === 'narrative') {
    await runBatchedAnalysis(...runArgs, narrativeAnalysisConfig(config, repoRoot, fileIdMap, guidedReview, analysisId), shouldCancel);
  } else {
    await runBatchedAnalysis(...runArgs, guidedAnalysisConfig(config, repoRoot, fileIdMap, guidedReview), shouldCancel);
  }
}

type ScoreInsert = Parameters<typeof appendFileScores>[1][number];
type Batch = { files: ReviewFile[]; estimatedTokens: number };

interface BatchedAnalysisConfig<T> {
  analysisType: 'risk' | 'narrative' | 'guided';
  runBatch: (files: ReviewFile[]) => Promise<T[]>;
  /** Optional in-place adjustment per result before mapping (e.g. risk's max-of-dimensions). */
  postProcessResult?: (result: T) => void;
  mapResult: (r: T, indexInBatch: number) => ScoreInsert;
  /** Optional aggregation across all results (e.g. risk sort, narrative merge). */
  finalize?: (allResults: T[], batchCount: number) => Promise<void>;
}

async function runBatchedAnalysis<T>(
  analysisId: string,
  batches: Batch[],
  totalFiles: number,
  progressTotal: number,
  progressOffset: number,
  cfg: BatchedAnalysisConfig<T>,
  shouldCancel?: () => boolean,
): Promise<void> {
  const allResults = await runBatches<T>(
    batches,
    totalFiles,
    async (batch) => cfg.runBatch(batch.files),
    async (_batchIndex, results) => {
      if (cfg.postProcessResult) {
        for (const r of results) cfg.postProcessResult(r);
      }
      const scores = results.map((r, idx) => cfg.mapResult(r, idx));
      await appendFileScores(analysisId, scores);
    },
    async (progress) => {
      await updateAnalysisProgress(analysisId, progressOffset + progress.completedFiles, progressTotal);
    },
    1,
    shouldCancel,
    cfg.analysisType,
  );

  if (cfg.finalize) await cfg.finalize(allResults, batches.length);
}

async function updateSortOrders(analysisId: string, entries: Iterable<[string, number]>): Promise<void> {
  const db = await getDb();
  for (const [filePath, sortOrder] of entries) {
    await db.query(
      'UPDATE ai_file_scores SET sort_order = $1 WHERE analysis_id = $2 AND file_path = $3',
      [sortOrder, analysisId, filePath]
    );
  }
}

function pickRunner<R>(real: () => Promise<R[]>, mock: () => Promise<R[]>): Promise<R[]> {
  return isAIServiceTest() ? mock() : real();
}

function riskAnalysisConfig(
  config: AIConfig,
  repoRoot: string,
  fileIdMap: Map<string, string>,
  guidedReview: GuidedReviewConfig | undefined,
  analysisId: string,
): BatchedAnalysisConfig<RiskFileResult> {
  return {
    analysisType: 'risk',
    runBatch: (files) => pickRunner(
      () => runRiskAnalysisBatch(files, config, repoRoot, guidedReview),
      () => mockRiskAnalysisBatch(files),
    ),
    postProcessResult: (r) => {
      const maxDimension = Math.max(...Object.values(r.scores));
      r.aggregate = Math.max(r.aggregate, maxDimension);
    },
    mapResult: (r) => ({
      reviewFileId: resolveFileId(fileIdMap, r.filePath),
      filePath: r.filePath,
      sortOrder: 0, // Placeholder — final sort happens after all batches
      aggregateScore: r.aggregate,
      rationale: r.rationale,
      dimensionScores: r.scores,
      notes: r.notes ?? null,
    }),
    finalize: async (allResults) => {
      const sorted = allResults.slice().sort((a, b) => b.aggregate - a.aggregate);
      await updateSortOrders(analysisId, sorted.map((r, idx) => [r.filePath, idx]));
    },
  };
}

function narrativeAnalysisConfig(
  config: AIConfig,
  repoRoot: string,
  fileIdMap: Map<string, string>,
  guidedReview: GuidedReviewConfig | undefined,
  analysisId: string,
): BatchedAnalysisConfig<NarrativeFileResult> {
  return {
    analysisType: 'narrative',
    runBatch: (files) => pickRunner(
      () => runNarrativeAnalysisBatch(files, config, repoRoot, guidedReview),
      () => mockNarrativeAnalysisBatch(files),
    ),
    mapResult: (r) => ({
      reviewFileId: resolveFileId(fileIdMap, r.filePath),
      filePath: r.filePath,
      sortOrder: r.position, // Batch-local position — will be re-sorted after merge
      aggregateScore: null,
      rationale: r.rationale,
      dimensionScores: null,
      notes: r.notes ?? null,
    }),
    finalize: async (allResults, batchCount) => {
      if (allResults.length === 0) return;
      const merged = mergeNarrativeOrders(allResults, batchCount);
      await updateSortOrders(analysisId, merged);
    },
  };
}

function guidedAnalysisConfig(
  config: AIConfig,
  repoRoot: string,
  fileIdMap: Map<string, string>,
  guidedReview: GuidedReviewConfig | undefined,
): BatchedAnalysisConfig<GuidedFileResult> {
  return {
    analysisType: 'guided',
    runBatch: (files) => {
      if (isAIServiceTest()) return mockGuidedAnalysisBatch(files);
      if (guidedReview === undefined) throw new Error('Guided review config required');
      return runGuidedAnalysisBatch(files, config, repoRoot, guidedReview);
    },
    mapResult: (r, idx) => ({
      reviewFileId: resolveFileId(fileIdMap, r.filePath),
      filePath: r.filePath,
      sortOrder: idx,
      aggregateScore: null,
      rationale: null,
      dimensionScores: null,
      notes: r.notes,
    }),
  };
}

aiAnalysisRoutes.get('/analysis/:type', async (c) => {
  const reviewId = resolveReviewId(c);
  const rawType = c.req.param('type');
  const typeParse = AnalysisTypeSchema.safeParse(rawType);
  if (!typeParse.success) return errorResponse(c, 'type must be risk|narrative|guided');
  const analysisType = typeParse.data;

  const analysis = await getLatestAnalysis(reviewId, analysisType);
  if (analysis === undefined) {
    debugLog(`GET /analysis/${analysisType}: no analysis found`);
    return c.json({ status: 'none', scores: [] });
  }

  debugLog(`GET /analysis/${analysisType}: id=${analysis.id}, status=${analysis.status}, error=${analysis.error_message ?? 'none'}`);

  if (analysis.status === 'failed') {
    return c.json({
      status: analysis.status,
      error: analysis.error_message,
      scores: [],
    });
  }

  // Return partial or complete results (works for both 'running' and 'completed')
  const scores = await getFileScoresForReview(reviewId, analysisType);
  return c.json({
    status: analysis.status,
    progressCompleted: analysis.progress_completed,
    progressTotal: analysis.progress_total,
    scores: scores.map(s => ({
      reviewFileId: s.review_file_id,
      filePath: s.file_path,
      sortOrder: s.sort_order,
      aggregateScore: s.aggregate_score,
      rationale: s.rationale,
      dimensionScores: parseJsonColumn(DimensionScoresSchema, s.dimension_scores),
      notes: parseJsonColumn(FileScoreNotesSchema, s.notes),
    })),
  });
});

aiAnalysisRoutes.get('/analysis/:type/status', async (c) => {
  const reviewId = resolveReviewId(c);
  const rawType = c.req.param('type');
  const typeParse = AnalysisTypeSchema.safeParse(rawType);
  if (!typeParse.success) return errorResponse(c, 'type must be risk|narrative|guided');
  const analysisType = typeParse.data;

  const analysis = await getLatestAnalysis(reviewId, analysisType);
  if (analysis === undefined) {
    debugLog(`GET /analysis/${analysisType}/status: no analysis found`);
    return c.json({ status: 'none' });
  }

  debugLog(`GET /analysis/${analysisType}/status: id=${analysis.id}, status=${analysis.status}, progress=${String(analysis.progress_completed)}/${String(analysis.progress_total)}, updated=${analysis.updated_at}`);

  // Auto-timeout stale running analyses (e.g. server restarted mid-analysis)
  if (analysis.status === 'running') {
    const ageMs = Date.now() - parseAnalysisTimestamp(analysis.updated_at).getTime();
    if (ageMs > 15 * 60 * 1000) {
      debugLog(`GET /analysis/${analysisType}/status: timing out stale analysis (age=${String(Math.round(ageMs / 1000))}s)`);
      await updateAnalysisStatus(analysis.id, 'failed', 'Analysis timed out');
      return c.json({ status: 'failed', error: 'Analysis timed out' });
    }
  }

  return c.json({
    status: analysis.status,
    error: analysis.error_message,
    progressCompleted: analysis.progress_completed,
    progressTotal: analysis.progress_total,
  });
});

// --- Debug ---

aiAnalysisRoutes.get('/debug-status', (c) => {
  return c.json({ enabled: isDebug() });
});

const DebugLogReqSchema = z.object({ message: z.string() });

aiAnalysisRoutes.post('/debug-log', async (c) => {
  if (!isDebug()) return c.json({ ok: true } as const);
  const parsed = await parseBody(c, DebugLogReqSchema);
  if (!parsed.ok) return parsed.response;
  debugLog(`[client] ${parsed.data.message}`);
  return c.json({ ok: true } as const);
});

// --- Preferences ---

aiAnalysisRoutes.get('/preferences', async (c) => {
  const prefs = await getUserPreferences();
  return c.json(prefs);
});

aiAnalysisRoutes.post('/preferences', async (c) => {
  const parsed = await parseBody(c, SaveAIPreferencesReqSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Project to a known allowlist before persisting — drops any unknown
  // keys the client may have sent. Only include keys actually set in the
  // body; including `undefined` for absent keys would let the spread in
  // `saveUserPreferences` overwrite existing values.
  const allowed: Partial<{
    sort_mode: string;
    risk_sort_dimension: string;
    show_risk_scores: boolean;
    ignore_whitespace: boolean;
    svg_view_mode: string;
    last_image_mode: string;
    image_sxs_orientation: string;
  }> = {};
  if (body.sort_mode !== undefined) allowed.sort_mode = body.sort_mode;
  if (body.risk_sort_dimension !== undefined) allowed.risk_sort_dimension = body.risk_sort_dimension;
  if (body.show_risk_scores !== undefined) allowed.show_risk_scores = body.show_risk_scores;
  if (body.ignore_whitespace !== undefined) allowed.ignore_whitespace = body.ignore_whitespace;
  if (body.svg_view_mode !== undefined) allowed.svg_view_mode = body.svg_view_mode;
  if (body.last_image_mode !== undefined) allowed.last_image_mode = body.last_image_mode;
  if (body.image_sxs_orientation !== undefined) allowed.image_sxs_orientation = body.image_sxs_orientation;
  await saveUserPreferences(allowed);
  return c.json({ ok: true } as const);
});
