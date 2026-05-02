import { Hono } from 'hono';

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
import { getModelContextWindow } from '../ai/models.js';
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
import type { ReviewFile } from '../db/queries.js';
import { getReviewFiles } from '../db/queries.js';
import { debugLog, isAIServiceTest, isDebug } from '../debug.js';
import type { AppEnv } from '../types.js';
import { resolveReviewId } from '../utils/resolveReviewId.js';
import { checkEnum } from '../utils/validate.js';

export const aiAnalysisRoutes = new Hono<AppEnv>();

const VALID_SORT_MODES = ['folder', 'risk', 'narrative', 'guided'] as const;
const VALID_RISK_DIMENSIONS = ['aggregate', 'security', 'correctness', 'error-handling', 'maintainability', 'architecture', 'performance'] as const;
const VALID_SVG_VIEW_MODES = ['code', 'rendered'] as const;
const VALID_IMAGE_MODES = ['metadata', 'side-by-side', 'difference', 'slice'] as const;
const VALID_ANALYSIS_TYPES = ['risk', 'narrative', 'guided'] as const;

// Track cancelled analysis IDs — checked by batch runner before starting new batches.
// When a user switches from risk→narrative (or vice versa), the old analysis is added here.
// Switching to folder mode does NOT cancel anything.
const cancelledAnalyses = new Set<string>();

// --- Analysis ---

aiAnalysisRoutes.post('/analyze', async (c) => {
  const reviewId = resolveReviewId(c);
  const repoRoot = c.get('repoRoot');
  const body = await c.req.json<{ type: string; invalidateCache?: boolean }>();
  const analysisType = body.type;
  const invalidateCache = body.invalidateCache === true;

  debugLog(`POST /analyze: type=${analysisType}, reviewId=${reviewId}`);

  const typeCheck = checkEnum(analysisType, 'type', VALID_ANALYSIS_TYPES);
  if ('error' in typeCheck) return c.json({ error: typeCheck.error }, 400);

  const testMode = isAIServiceTest();
  const config = loadAIConfig();
  if (config.apiKey === null && !testMode) {
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
    debugLog('POST /analyze: invalidateCache=true, cancelling all running analyses');
    for (const type of ['risk', 'narrative', 'guided'] as const) {
      const running = await getLatestAnalysis(reviewId, type);
      if (running !== undefined && running.status === 'running') {
        debugLog(`POST /analyze: cancelling ${type} analysis id=${running.id}`);
        cancelledAnalyses.add(running.id);
        await updateAnalysisStatus(running.id, 'failed', 'Cancelled');
      }
    }
  } else if (analysisType === 'risk' || analysisType === 'narrative') {
    // Risk↔narrative cancel each other; guided runs independently
    const otherType = analysisType === 'risk' ? 'narrative' : 'risk';
    const otherRunning = await getLatestAnalysis(reviewId, otherType);
    if (otherRunning !== undefined && otherRunning.status === 'running') {
      debugLog(`POST /analyze: cancelling ${otherType} analysis id=${otherRunning.id} (switching to ${analysisType})`);
      cancelledAnalyses.add(otherRunning.id);
    }
  }

  if (!invalidateCache) {
    // Deduplicate: if there's already a running analysis of this type, return it
    const existing = await getLatestAnalysis(reviewId, analysisType);
    if (existing !== undefined) {
      debugLog(`POST /analyze: found existing ${analysisType} analysis id=${existing.id}, status=${existing.status}, created=${existing.created_at}, updated=${existing.updated_at}`);
    }
    if (existing !== undefined && existing.status === 'running') {
      const ageMs = Date.now() - new Date(existing.updated_at + 'Z').getTime();
      debugLog(`POST /analyze: existing analysis age=${String(Math.round(ageMs / 1000))}s`);
      if (ageMs < 15 * 60 * 1000) {
        // Still recent, reuse it
        debugLog('POST /analyze: reusing existing running analysis');
        return c.json({ analysisId: existing.id, status: 'running' });
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
  void executeAnalysis({
    analysisId: analysis.id,
    analysisType: typeCheck.ok,
    reviewId,
    files,
    config,
    repoRoot,
    guidedReview,
    invalidateCache,
  });

  return c.json({ analysisId: analysis.id, status: 'running' });
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
 * carry-forward, binary file scoring, batch dispatch, finalise, and
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
    const totalAnalyzable = batches.reduce((sum, b) => sum + b.files.length, 0);

    debugLog(`Analysis plan: ${String(totalAnalyzable)} analyzable + ${String(binaryFiles.length)} binary = ${String(totalAnalyzable + binaryFiles.length)} total files in ${String(batches.length)} batch(es)`);

    // --- Cache: carry forward scores from a previous analysis (same review) ---
    // Skip cache when invalidateCache is true (e.g. guided review settings changed)
    const prevScores = invalidateCache ? [] : await getPreviousScores(reviewId, analysisType, analysisId);
    const binaryPathSet = new Set(binaryFiles.map(f => f.file_path));
    const unchangedPaths = new Set<string>();
    const cachedScores = prevScores.filter(s => {
      // Only carry forward non-binary files that still exist in the review
      // (binary files are re-saved separately below)
      if (fileIdMap.has(s.file_path) && !binaryPathSet.has(s.file_path)) {
        unchangedPaths.add(s.file_path);
        return true;
      }
      return false;
    });

    debugLog(`Cache: ${String(cachedScores.length)} scores from previous analysis, ${String(totalAnalyzable - cachedScores.length)} files need processing`);

    // Save cached scores immediately with updated review_file_ids
    if (cachedScores.length > 0) {
      const cachedForInsert = cachedScores.map(s => ({
        reviewFileId: fileIdMap.get(s.file_path) ?? s.review_file_id,
        filePath: s.file_path,
        sortOrder: s.sort_order,
        aggregateScore: s.aggregate_score,
        rationale: s.rationale,
        dimensionScores: s.dimension_scores !== null ? JSON.parse(s.dimension_scores) as Record<string, number> : null,
        notes: s.notes !== null ? JSON.parse(s.notes) as { overview: string; lines: Array<{ line: number; content: string }> } : null,
      }));
      await appendFileScores(analysisId, cachedForInsert);
    }

    // Filter batches to exclude files with cached scores
    const filteredBatches = batches
      .map(batch => {
        const remaining = batch.files.filter(f => !unchangedPaths.has(f.file_path));
        return { files: remaining, estimatedTokens: batch.estimatedTokens };
      })
      .filter(batch => batch.files.length > 0);

    // Recalculate totals
    const filteredAnalyzable = filteredBatches.reduce((sum, b) => sum + b.files.length, 0);
    const totalForProgress = filteredAnalyzable + binaryFiles.length + cachedScores.length;

    debugLog(`After cache: ${String(filteredAnalyzable)} files to analyze in ${String(filteredBatches.length)} batch(es)`);

    // Set total progress
    await updateAnalysisProgress(analysisId, cachedScores.length, totalForProgress);

    // Save binary files immediately with score 0
    if (binaryFiles.length > 0) {
      debugLog(`Saving ${String(binaryFiles.length)} binary files with score 0`);
      const binaryScoreEntries = binaryFiles.map((f, idx) => ({
        reviewFileId: fileIdMap.get(f.file_path) ?? '',
        filePath: f.file_path,
        sortOrder: 99999 + idx, // Will be re-sorted later
        aggregateScore: analysisType === 'risk' ? 0 : null,
        rationale: 'Binary file — not analyzed',
        dimensionScores: analysisType === 'risk'
          ? { security: 0, correctness: 0, 'error-handling': 0, maintainability: 0, architecture: 0, performance: 0 }
          : null,
        notes: null,
      }));
      await appendFileScores(analysisId, binaryScoreEntries);
      await updateAnalysisProgress(analysisId, cachedScores.length + binaryFiles.length, totalForProgress);
    }

    if (filteredBatches.length === 0) {
      debugLog('No batches to process (all files cached or binary), marking completed');
      await updateAnalysisStatus(analysisId, 'completed');
      return;
    }

    const shouldCancel = () => cancelledAnalyses.has(analysisId);
    const progressOffset = cachedScores.length + binaryFiles.length;

    const runArgs = [analysisId, filteredBatches, files.length, totalForProgress, progressOffset] as const;
    if (analysisType === 'risk') {
      await runBatchedAnalysis(...runArgs, riskAnalysisConfig(config, repoRoot, fileIdMap, guidedReview, analysisId), shouldCancel);
    } else if (analysisType === 'narrative') {
      await runBatchedAnalysis(...runArgs, narrativeAnalysisConfig(config, repoRoot, fileIdMap, guidedReview, analysisId), shouldCancel);
    } else {
      await runBatchedAnalysis(...runArgs, guidedAnalysisConfig(config, repoRoot, fileIdMap, guidedReview), shouldCancel);
    }

    // Check if this analysis was cancelled while running (user switched modes)
    if (cancelledAnalyses.has(analysisId)) {
      cancelledAnalyses.delete(analysisId);
      debugLog(`Analysis ${analysisId} was cancelled (user switched modes)`);
      await updateAnalysisStatus(analysisId, 'failed', 'Cancelled');
      return;
    }

    cancelledAnalyses.delete(analysisId);
    debugLog(`Analysis ${analysisId} completed successfully`);
    await updateAnalysisStatus(analysisId, 'completed');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Analysis failed: ${message}`);
    debugLog(`Analysis ${analysisId} failed: ${message}`);
    await updateAnalysisStatus(analysisId, 'failed', message);
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
  const { getDb } = await import('../db/connection.js');
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
      reviewFileId: fileIdMap.get(r.filePath) ?? '',
      filePath: r.filePath,
      sortOrder: 0, // Placeholder — final sort happens after all batches
      aggregateScore: r.aggregate,
      rationale: r.rationale,
      dimensionScores: r.scores as Record<string, number>,
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
      reviewFileId: fileIdMap.get(r.filePath) ?? '',
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
      reviewFileId: fileIdMap.get(r.filePath) ?? '',
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
  const analysisType = c.req.param('type');

  const typeCheck = checkEnum(analysisType, 'type', VALID_ANALYSIS_TYPES);
  if ('error' in typeCheck) return c.json({ error: typeCheck.error }, 400);

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
      dimensionScores: s.dimension_scores !== null ? JSON.parse(s.dimension_scores) as Record<string, number> : null,
      notes: s.notes !== null ? JSON.parse(s.notes) as { overview: string; lines: Array<{ line: number; content: string }> } : null,
    })),
  });
});

aiAnalysisRoutes.get('/analysis/:type/status', async (c) => {
  const reviewId = resolveReviewId(c);
  const analysisType = c.req.param('type');

  const typeCheck = checkEnum(analysisType, 'type', VALID_ANALYSIS_TYPES);
  if ('error' in typeCheck) return c.json({ error: typeCheck.error }, 400);

  const analysis = await getLatestAnalysis(reviewId, analysisType);
  if (analysis === undefined) {
    debugLog(`GET /analysis/${analysisType}/status: no analysis found`);
    return c.json({ status: 'none' });
  }

  debugLog(`GET /analysis/${analysisType}/status: id=${analysis.id}, status=${analysis.status}, progress=${String(analysis.progress_completed)}/${String(analysis.progress_total)}, updated=${analysis.updated_at}`);

  // Auto-timeout stale running analyses (e.g. server restarted mid-analysis)
  if (analysis.status === 'running') {
    const ageMs = Date.now() - new Date(analysis.updated_at + 'Z').getTime();
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

aiAnalysisRoutes.post('/debug-log', async (c) => {
  if (!isDebug()) return c.json({ ok: true });
  const body = await c.req.json<{ message: string }>();
  if (typeof body.message !== 'string') {
    return c.json({ error: 'message must be a string' }, 400);
  }
  debugLog(`[client] ${body.message}`);
  return c.json({ ok: true });
});

// --- Preferences ---

aiAnalysisRoutes.get('/preferences', async (c) => {
  const prefs = await getUserPreferences();
  return c.json(prefs);
});

aiAnalysisRoutes.post('/preferences', async (c) => {
  const body = await c.req.json<{ sort_mode?: string; risk_sort_dimension?: string; show_risk_scores?: boolean; ignore_whitespace?: boolean; svg_view_mode?: string; last_image_mode?: string }>();

  if (body.sort_mode !== undefined) {
    const v = checkEnum(body.sort_mode, 'sort_mode', VALID_SORT_MODES);
    if ('error' in v) return c.json({ error: v.error }, 400);
  }
  if (body.risk_sort_dimension !== undefined) {
    const v = checkEnum(body.risk_sort_dimension, 'risk_sort_dimension', VALID_RISK_DIMENSIONS);
    if ('error' in v) return c.json({ error: v.error }, 400);
  }
  if (body.show_risk_scores !== undefined && typeof body.show_risk_scores !== 'boolean') {
    return c.json({ error: 'show_risk_scores must be a boolean' }, 400);
  }
  if (body.ignore_whitespace !== undefined && typeof body.ignore_whitespace !== 'boolean') {
    return c.json({ error: 'ignore_whitespace must be a boolean' }, 400);
  }
  if (body.svg_view_mode !== undefined) {
    const v = checkEnum(body.svg_view_mode, 'svg_view_mode', VALID_SVG_VIEW_MODES);
    if ('error' in v) return c.json({ error: v.error }, 400);
  }
  if (body.last_image_mode !== undefined) {
    const v = checkEnum(body.last_image_mode, 'last_image_mode', VALID_IMAGE_MODES);
    if ('error' in v) return c.json({ error: v.error }, 400);
  }

  await saveUserPreferences(body);
  return c.json({ ok: true });
});
