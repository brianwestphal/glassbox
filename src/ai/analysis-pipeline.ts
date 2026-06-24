/**
 * The background AI-analysis pipeline. Split out of `routes/ai-analysis.ts` so
 * that file is just HTTP routing — this module owns the long-running work a
 * single `analyses` row drives: cache carry-forward, binary-file scoring, batch
 * dispatch per analysis type, finalize (risk sort / narrative merge), and
 * cancellation handling.
 *
 * Cancellation is process-global state (`canceledAnalyses`): the route marks an
 * analysis canceled via {@link markAnalysisCanceled} when the user switches
 * sort modes, and the running pipeline checks it between batches and on
 * completion. The Set is the single source of truth, owned here.
 */
import {
  appendFileScores,
  getPreviousScores,
  updateAnalysisProgress,
  updateAnalysisStatus,
} from '../db/ai-queries.js';
import { getDb } from '../db/connection.js';
import type { ReviewFile } from '../db/queries.js';
import { DimensionScoresSchema, FileScoreNotesSchema, parseJsonColumn } from '../db/schemas.js';
import { debugLog, isAIServiceTest } from '../debug.js';
import type { GuidedFileResult } from './analyze-guided.js';
import { runGuidedAnalysisBatch } from './analyze-guided.js';
import type { NarrativeFileResult } from './analyze-narrative.js';
import { mergeNarrativeOrders, runNarrativeAnalysisBatch } from './analyze-narrative.js';
import type { RiskFileResult } from './analyze-risk.js';
import { runRiskAnalysisBatch } from './analyze-risk.js';
import { planBatches } from './batch-planner.js';
import { runBatches } from './batch-runner.js';
import type { AIConfig, GuidedReviewConfig } from './config.js';
import { mockGuidedAnalysisBatch, mockNarrativeAnalysisBatch, mockRiskAnalysisBatch } from './mock.js';
import { getModelContextWindow } from './models.js';

// Track canceled analysis IDs — checked by the batch runner before starting new
// batches. When a user switches from risk→narrative (or vice versa), the old
// analysis is added here. Switching to folder mode does NOT cancel anything.
const canceledAnalyses = new Set<string>();

/** Mark a running analysis as canceled so the pipeline stops it between batches.
 *  Called by the routing layer when the user switches analysis modes. */
export function markAnalysisCanceled(analysisId: string): void {
  canceledAnalyses.add(analysisId);
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

export interface ExecuteAnalysisInput {
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
export async function executeAnalysis(input: ExecuteAnalysisInput): Promise<void> {
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
  } finally {
    // Always drop the cancellation marker — a run that throws before reaching
    // the success-path delete would otherwise leave its id lingering in the Set.
    canceledAnalyses.delete(analysisId);
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
  /** Optional aggregation across all results (e.g. risk sort, narrative merge).
   *  `batchedResults` is the real per-batch grouping (one inner array per
   *  completed batch, in batch order) — use it rather than re-deriving batch
   *  boundaries from the flat `allResults`. */
  finalize?: (allResults: T[], batchedResults: T[][]) => Promise<void>;
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
  // Capture the real per-batch result groups (keyed by batch index, so a failed
  // batch simply leaves a hole) for finalizers that need true batch boundaries.
  const batchedResults: (T[] | undefined)[] = [];
  const allResults = await runBatches<T>(
    batches,
    totalFiles,
    async (batch) => cfg.runBatch(batch.files),
    async (batchIndex, results) => {
      batchedResults[batchIndex] = results;
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

  // `.filter()` over the sparse array drops holes left by failed batches.
  if (cfg.finalize) await cfg.finalize(allResults, batchedResults.filter((b): b is T[] => b !== undefined));
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
    finalize: async (allResults, batchedResults) => {
      if (allResults.length === 0) return;
      const merged = mergeNarrativeOrders(batchedResults);
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
