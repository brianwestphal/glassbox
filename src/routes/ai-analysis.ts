import { Hono } from 'hono';
import { z } from 'zod';

import { executeAnalysis, markAnalysisCanceled } from '../ai/analysis-pipeline.js';
import { loadAIConfig, loadGuidedReviewConfig } from '../ai/config.js';
import { KEYLESS_PLATFORMS } from '../ai/models.js';
import {
  AnalysisTypeSchema,
  SaveAIPreferencesReqSchema,
  StartAnalysisReqSchema,
} from '../api/index.js';
import {
  createAnalysis,
  getFileScoresForReview,
  getLatestAnalysis,
  getUserPreferences,
  saveUserPreferences,
  updateAnalysisStatus,
} from '../db/ai-queries.js';
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
        markAnalysisCanceled(running.id);
        await updateAnalysisStatus(running.id, 'failed', 'Canceled');
      }
    }
  } else if (analysisType === 'risk' || analysisType === 'narrative') {
    // Risk↔narrative cancel each other; guided runs independently
    const otherType = analysisType === 'risk' ? 'narrative' : 'risk';
    const otherRunning = await getLatestAnalysis(reviewId, otherType);
    if (otherRunning !== undefined && otherRunning.status === 'running') {
      debugLog(`POST /analyze: canceling ${otherType} analysis id=${otherRunning.id} (switching to ${analysisType})`);
      markAnalysisCanceled(otherRunning.id);
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
    if (ageMs > ANALYSIS_REUSE_TIMEOUT_MS) {
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
