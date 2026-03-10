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
import {
  deleteAPIKey,
  detectAvailablePlatforms,
  getKeychainLabel,
  isKeychainAvailable,
  loadAIConfig,
  loadGuidedReviewConfig,
  resolveAPIKey,
  saveAIConfigPreferences,
  saveAPIKey,
  saveGuidedReviewConfig,
} from '../ai/config.js';
import { mockGuidedAnalysisBatch, mockNarrativeAnalysisBatch, mockRiskAnalysisBatch } from '../ai/mock.js';
import type { AIPlatform } from '../ai/models.js';
import { getModelContextWindow, MODELS, PLATFORMS } from '../ai/models.js';
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

export const aiApiRoutes = new Hono<AppEnv>();

// Track cancelled analysis IDs — checked by batch runner before starting new batches.
// When a user switches from risk→narrative (or vice versa), the old analysis is added here.
// Switching to folder mode does NOT cancel anything.
const cancelledAnalyses = new Set<string>();

// --- Configuration ---

aiApiRoutes.get('/config', (c) => {
  const config = loadAIConfig();
  return c.json({
    platform: config.platform,
    model: config.model,
    keyConfigured: config.apiKey !== null || isAIServiceTest(),
    keySource: config.keySource,
    guidedReview: loadGuidedReviewConfig(),
  });
});

aiApiRoutes.post('/config', async (c) => {
  const body = await c.req.json<{
    platform: string;
    model: string;
    guidedReview?: { enabled: boolean; topics: string[] };
  }>();
  saveAIConfigPreferences(body.platform as AIPlatform, body.model);
  if (body.guidedReview !== undefined) {
    saveGuidedReviewConfig(body.guidedReview);
  }
  return c.json({ ok: true });
});

aiApiRoutes.get('/models', (c) => {
  return c.json({
    platforms: PLATFORMS,
    models: MODELS,
  });
});

aiApiRoutes.get('/key-status', (c) => {
  const platforms = (['anthropic', 'openai', 'google'] as AIPlatform[]);
  const status: Record<string, { configured: boolean; source: string | null }> = {};
  for (const platform of platforms) {
    const { source } = resolveAPIKey(platform);
    status[platform] = { configured: source !== null, source };
  }
  return c.json({
    status,
    keychainAvailable: isKeychainAvailable(),
    keychainLabel: getKeychainLabel(),
    availablePlatforms: detectAvailablePlatforms(),
  });
});

aiApiRoutes.post('/key', async (c) => {
  const body = await c.req.json<{ platform: string; key: string; storage: string }>();
  saveAPIKey(
    body.platform as AIPlatform,
    body.key,
    body.storage as 'keychain' | 'config',
  );
  return c.json({ ok: true });
});

aiApiRoutes.delete('/key', (c) => {
  const platform = c.req.query('platform') ?? 'anthropic';
  deleteAPIKey(platform as AIPlatform);
  return c.json({ ok: true });
});

// --- Analysis ---

aiApiRoutes.post('/analyze', async (c) => {
  const reviewId = c.req.query('reviewId') ?? '';
  const repoRoot = c.get('repoRoot');
  const body = await c.req.json<{ type: string; invalidateCache?: boolean }>();
  const analysisType = body.type;
  const invalidateCache = body.invalidateCache === true;

  debugLog(`POST /analyze: type=${analysisType}, reviewId=${reviewId}`);

  if (analysisType !== 'risk' && analysisType !== 'narrative' && analysisType !== 'guided') {
    return c.json({ error: 'Invalid analysis type' }, 400);
  }

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

  // Run batched analysis in background
  void (async () => {
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
      const prevScores = invalidateCache ? [] : await getPreviousScores(reviewId, analysisType, analysis.id);
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
        await appendFileScores(analysis.id, cachedForInsert);
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
      await updateAnalysisProgress(analysis.id, cachedScores.length, totalForProgress);

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
        await appendFileScores(analysis.id, binaryScoreEntries);
        await updateAnalysisProgress(analysis.id, cachedScores.length + binaryFiles.length, totalForProgress);
      }

      if (filteredBatches.length === 0) {
        debugLog('No batches to process (all files cached or binary), marking completed');
        await updateAnalysisStatus(analysis.id, 'completed');
        return;
      }

      const shouldCancel = () => cancelledAnalyses.has(analysis.id);
      const progressOffset = cachedScores.length + binaryFiles.length;

      if (analysisType === 'risk') {
        await runBatchedRiskAnalysis(analysis.id, filteredBatches, files, config, repoRoot, fileIdMap, totalForProgress, progressOffset, shouldCancel, guidedReview);
      } else if (analysisType === 'narrative') {
        await runBatchedNarrativeAnalysis(analysis.id, filteredBatches, files, config, repoRoot, fileIdMap, totalForProgress, progressOffset, shouldCancel, guidedReview);
      } else {
        await runBatchedGuidedAnalysis(analysis.id, filteredBatches, files, config, repoRoot, fileIdMap, totalForProgress, progressOffset, shouldCancel, guidedReview);
      }

      // Check if this analysis was cancelled while running (user switched modes)
      if (cancelledAnalyses.has(analysis.id)) {
        cancelledAnalyses.delete(analysis.id);
        debugLog(`Analysis ${analysis.id} was cancelled (user switched modes)`);
        await updateAnalysisStatus(analysis.id, 'failed', 'Cancelled');
        return;
      }

      cancelledAnalyses.delete(analysis.id);
      debugLog(`Analysis ${analysis.id} completed successfully`);
      await updateAnalysisStatus(analysis.id, 'completed');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Analysis failed: ${message}`);
      debugLog(`Analysis ${analysis.id} failed: ${message}`);
      await updateAnalysisStatus(analysis.id, 'failed', message);
    }
  })();

  return c.json({ analysisId: analysis.id, status: 'running' });
});

async function runBatchedRiskAnalysis(
  analysisId: string,
  batches: Array<{ files: ReviewFile[]; estimatedTokens: number }>,
  allFiles: ReviewFile[],
  config: AIConfig,
  repoRoot: string,
  fileIdMap: Map<string, string>,
  progressTotal: number,
  progressOffset: number,
  shouldCancel?: () => boolean,
  guidedReview?: GuidedReviewConfig,
): Promise<void> {
  const allResults = await runBatches<RiskFileResult>(
    batches,
    allFiles.length,
    async (batch) => isAIServiceTest()
      ? mockRiskAnalysisBatch(batch.files)
      : runRiskAnalysisBatch(batch.files, config, repoRoot, guidedReview),
    async (_batchIndex, results) => {
      // Post-process: aggregate = max of individual dimension scores
      for (const r of results) {
        const maxDimension = Math.max(...Object.values(r.scores));
        r.aggregate = Math.max(r.aggregate, maxDimension);
      }

      // Save this batch's results incrementally (unsorted — will be re-sorted at end)
      const scores = results.map((r) => ({
        reviewFileId: fileIdMap.get(r.filePath) ?? '',
        filePath: r.filePath,
        sortOrder: 0, // Placeholder — final sort happens after all batches
        aggregateScore: r.aggregate,
        rationale: r.rationale,
        dimensionScores: r.scores as Record<string, number>,
        notes: r.notes ?? null,
      }));
      await appendFileScores(analysisId, scores);
    },
    async (progress) => {
      await updateAnalysisProgress(analysisId, progressOffset + progress.completedFiles, progressTotal);
    },
    1,
    shouldCancel,
    'risk',
  );

  // Final sort: update sort_order based on aggregate score descending
  const sorted = allResults.slice().sort((a, b) => b.aggregate - a.aggregate);
  const sortMap = new Map(sorted.map((r, idx) => [r.filePath, idx]));

  // Update sort orders in DB
  const { getDb } = await import('../db/connection.js');
  const db = await getDb();
  for (const [filePath, sortOrder] of sortMap) {
    await db.query(
      'UPDATE ai_file_scores SET sort_order = $1 WHERE analysis_id = $2 AND file_path = $3',
      [sortOrder, analysisId, filePath]
    );
  }
}

async function runBatchedNarrativeAnalysis(
  analysisId: string,
  batches: Array<{ files: ReviewFile[]; estimatedTokens: number }>,
  allFiles: ReviewFile[],
  config: AIConfig,
  repoRoot: string,
  fileIdMap: Map<string, string>,
  progressTotal: number,
  progressOffset: number,
  shouldCancel?: () => boolean,
  guidedReview?: GuidedReviewConfig,
): Promise<void> {
  const allResults = await runBatches<NarrativeFileResult>(
    batches,
    allFiles.length,
    async (batch) => isAIServiceTest()
      ? mockNarrativeAnalysisBatch(batch.files)
      : runNarrativeAnalysisBatch(batch.files, config, repoRoot, guidedReview),
    async (_batchIndex, results) => {
      // Save this batch's results incrementally
      const scores = results.map(r => ({
        reviewFileId: fileIdMap.get(r.filePath) ?? '',
        filePath: r.filePath,
        sortOrder: r.position, // Batch-local position — will be re-sorted after merge
        aggregateScore: null,
        rationale: r.rationale,
        dimensionScores: null,
        notes: r.notes ?? null,
      }));
      await appendFileScores(analysisId, scores);
    },
    async (progress) => {
      await updateAnalysisProgress(analysisId, progressOffset + progress.completedFiles, progressTotal);
    },
    1,
    shouldCancel,
    'narrative',
  );

  // Merge batch-local reading orders into a global order
  if (allResults.length > 0) {
    const mergedPositions = mergeNarrativeOrders(allResults, batches.length);

    const { getDb } = await import('../db/connection.js');
    const db = await getDb();
    for (const [filePath, position] of mergedPositions) {
      await db.query(
        'UPDATE ai_file_scores SET sort_order = $1 WHERE analysis_id = $2 AND file_path = $3',
        [position, analysisId, filePath]
      );
    }
  }
}

async function runBatchedGuidedAnalysis(
  analysisId: string,
  batches: Array<{ files: ReviewFile[]; estimatedTokens: number }>,
  allFiles: ReviewFile[],
  config: AIConfig,
  repoRoot: string,
  fileIdMap: Map<string, string>,
  progressTotal: number,
  progressOffset: number,
  shouldCancel?: () => boolean,
  guidedReview?: GuidedReviewConfig,
): Promise<void> {
  await runBatches<GuidedFileResult>(
    batches,
    allFiles.length,
    async (batch) => {
      if (isAIServiceTest()) return mockGuidedAnalysisBatch(batch.files);
      if (guidedReview === undefined) throw new Error('Guided review config required');
      return runGuidedAnalysisBatch(batch.files, config, repoRoot, guidedReview);
    },
    async (_batchIndex, results) => {
      const scores = results.map((r, idx) => ({
        reviewFileId: fileIdMap.get(r.filePath) ?? '',
        filePath: r.filePath,
        sortOrder: idx,
        aggregateScore: null,
        rationale: null,
        dimensionScores: null,
        notes: r.notes,
      }));
      await appendFileScores(analysisId, scores);
    },
    async (progress) => {
      await updateAnalysisProgress(analysisId, progressOffset + progress.completedFiles, progressTotal);
    },
    1,
    shouldCancel,
    'guided',
  );
}

aiApiRoutes.get('/analysis/:type', async (c) => {
  const reviewId = c.req.query('reviewId') ?? '';
  const analysisType = c.req.param('type');

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

aiApiRoutes.get('/analysis/:type/status', async (c) => {
  const reviewId = c.req.query('reviewId') ?? '';
  const analysisType = c.req.param('type');

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

aiApiRoutes.get('/debug-status', (c) => {
  return c.json({ enabled: isDebug() });
});

aiApiRoutes.post('/debug-log', async (c) => {
  if (!isDebug()) return c.json({ ok: true });
  const body = await c.req.json<{ message: string }>();
  debugLog(`[client] ${body.message}`);
  return c.json({ ok: true });
});

// --- Preferences ---

aiApiRoutes.get('/preferences', async (c) => {
  const prefs = await getUserPreferences();
  return c.json(prefs);
});

aiApiRoutes.post('/preferences', async (c) => {
  const body = await c.req.json<{ sort_mode?: string; risk_sort_dimension?: string; show_risk_scores?: boolean }>();
  await saveUserPreferences(body);
  return c.json({ ok: true });
});
