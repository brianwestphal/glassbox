import { getDb } from './connection.js';
import { generateId } from './ids.js';
import type { AIAnalysis, AIFileScore, DimensionScores, FileScoreNotes, UserPreferences } from './schemas.js';
import {
  AIAnalysisSchema,
  AIFileScoreSchema,
  parseRow,
  parseRows,
  UserPreferencesSchema,
} from './schemas.js';

export type { AIAnalysis, AIFileScore, DimensionScores, FileScoreNotes, UserPreferences } from './schemas.js';

// --- AI Analyses ---

export async function createAnalysis(reviewId: string, analysisType: string): Promise<AIAnalysis> {
  const db = await getDb();
  const id = generateId();
  const result = await db.query(
    `INSERT INTO ai_analyses (id, review_id, analysis_type, status)
     VALUES ($1, $2, $3, 'running') RETURNING *`,
    [id, reviewId, analysisType]
  );
  const analysis = parseRow(AIAnalysisSchema, result.rows[0]);
  if (analysis === undefined) throw new Error('createAnalysis: INSERT did not return a row');
  return analysis;
}

export async function updateAnalysisStatus(id: string, status: string, errorMessage?: string): Promise<void> {
  const db = await getDb();
  await db.query(
    'UPDATE ai_analyses SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
    [status, errorMessage ?? null, id]
  );
}

export async function updateAnalysisProgress(id: string, completed: number, total: number): Promise<void> {
  const db = await getDb();
  await db.query(
    'UPDATE ai_analyses SET progress_completed = $1, progress_total = $2, updated_at = NOW() WHERE id = $3',
    [completed, total, id]
  );
}

export async function getLatestAnalysis(reviewId: string, analysisType: string): Promise<AIAnalysis | undefined> {
  const db = await getDb();
  const result = await db.query(
    `SELECT * FROM ai_analyses
     WHERE review_id = $1 AND analysis_type = $2
     ORDER BY created_at DESC LIMIT 1`,
    [reviewId, analysisType]
  );
  return parseRow(AIAnalysisSchema, result.rows[0]);
}

// --- AI File Scores ---

export interface FileScoreInput {
  reviewFileId: string;
  filePath: string;
  sortOrder: number;
  aggregateScore: number | null;
  rationale: string | null;
  dimensionScores: DimensionScores | null;
  notes: FileScoreNotes | null;
}

export async function saveFileScores(
  analysisId: string,
  scores: FileScoreInput[]
): Promise<void> {
  const db = await getDb();
  // Delete existing scores for this analysis
  await db.query('DELETE FROM ai_file_scores WHERE analysis_id = $1', [analysisId]);

  for (const score of scores) {
    const id = generateId();
    await db.query(
      `INSERT INTO ai_file_scores (id, analysis_id, review_file_id, file_path, sort_order, aggregate_score, rationale, dimension_scores, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        analysisId,
        score.reviewFileId,
        score.filePath,
        score.sortOrder,
        score.aggregateScore,
        score.rationale,
        score.dimensionScores !== null ? JSON.stringify(score.dimensionScores) : null,
        score.notes !== null ? JSON.stringify(score.notes) : null,
      ]
    );
  }
}

/** Append scores for a batch without deleting existing scores for this analysis.
 *  Skips files that already have a score (deduplication). */
export async function appendFileScores(
  analysisId: string,
  scores: FileScoreInput[]
): Promise<void> {
  const db = await getDb();

  // Find which files already have scores for this analysis
  const existingResult = await db.query(
    'SELECT file_path FROM ai_file_scores WHERE analysis_id = $1',
    [analysisId]
  );
  const FilePathRowSchema = AIFileScoreSchema.pick({ file_path: true });
  const existingRows = parseRows(FilePathRowSchema, existingResult.rows);
  const existingPaths = new Set(existingRows.map(r => r.file_path));

  for (const score of scores) {
    if (existingPaths.has(score.filePath)) continue;
    const id = generateId();
    await db.query(
      `INSERT INTO ai_file_scores (id, analysis_id, review_file_id, file_path, sort_order, aggregate_score, rationale, dimension_scores, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        analysisId,
        score.reviewFileId,
        score.filePath,
        score.sortOrder,
        score.aggregateScore,
        score.rationale,
        score.dimensionScores !== null ? JSON.stringify(score.dimensionScores) : null,
        score.notes !== null ? JSON.stringify(score.notes) : null,
      ]
    );
  }
}

export async function getFileScores(analysisId: string): Promise<AIFileScore[]> {
  const db = await getDb();
  const result = await db.query(
    'SELECT * FROM ai_file_scores WHERE analysis_id = $1 ORDER BY sort_order',
    [analysisId]
  );
  return parseRows(AIFileScoreSchema, result.rows);
}

export async function getFileScoresForReview(reviewId: string, analysisType: string): Promise<AIFileScore[]> {
  const db = await getDb();
  const result = await db.query(
    `SELECT s.* FROM ai_file_scores s
     JOIN ai_analyses a ON s.analysis_id = a.id
     WHERE a.review_id = $1 AND a.analysis_type = $2 AND a.status IN ('completed', 'running')
     ORDER BY a.created_at DESC, s.sort_order
     LIMIT 1000`,
    [reviewId, analysisType]
  );
  // Only return scores from the latest analysis (completed or running)
  const parsed = parseRows(AIFileScoreSchema, result.rows);
  if (parsed.length === 0) return [];
  const latestAnalysisId = parsed[0].analysis_id;
  const rows = parsed.filter(r => r.analysis_id === latestAnalysisId);

  // Deduplicate by file_path — keep the first (lowest sort_order) entry per file
  const seen = new Set<string>();
  return rows.filter(r => {
    if (seen.has(r.file_path)) return false;
    seen.add(r.file_path);
    return true;
  });
}

/** Get file scores from a previous analysis for this review+type.
 *  Prefers completed analyses, but falls back to failed ones (which may have
 *  partial scores from interrupted runs). Used to carry forward cached scores. */
export async function getPreviousScores(
  reviewId: string,
  analysisType: string,
  excludeAnalysisId: string,
): Promise<AIFileScore[]> {
  const db = await getDb();
  // Try completed first, then failed (which may have partial results)
  for (const status of ['completed', 'failed']) {
    const result = await db.query(
      `SELECT s.* FROM ai_file_scores s
       JOIN ai_analyses a ON s.analysis_id = a.id
       WHERE a.review_id = $1 AND a.analysis_type = $2 AND a.status = $3
         AND a.id != $4
       ORDER BY a.created_at DESC, s.sort_order
       LIMIT 1000`,
      [reviewId, analysisType, status, excludeAnalysisId]
    );
    const parsed = parseRows(AIFileScoreSchema, result.rows);
    if (parsed.length > 0) {
      const latestAnalysisId = parsed[0].analysis_id;
      return parsed.filter(r => r.analysis_id === latestAnalysisId);
    }
  }
  return [];
}

// --- User Preferences ---

export async function getUserPreferences(): Promise<UserPreferences> {
  const db = await getDb();
  const result = await db.query(
    'SELECT * FROM user_preferences WHERE id = $1',
    ['singleton']
  );
  const defaults: UserPreferences = {
    sort_mode: 'folder',
    risk_sort_dimension: 'aggregate',
    show_risk_scores: false,
    ignore_whitespace: false,
    svg_view_mode: 'code',
    last_image_mode: 'side-by-side',
    image_sxs_orientation: 'left-right',
  };
  if (result.rows.length === 0) return defaults;
  // Some legacy rows may have NULL columns; fall back to defaults per field
  // using the raw row before schema-strict validation.
  const raw = result.rows[0] as Record<string, unknown>;
  const merged = {
    sort_mode: typeof raw.sort_mode === 'string' ? raw.sort_mode : defaults.sort_mode,
    risk_sort_dimension: typeof raw.risk_sort_dimension === 'string' ? raw.risk_sort_dimension : defaults.risk_sort_dimension,
    show_risk_scores: typeof raw.show_risk_scores === 'boolean' ? raw.show_risk_scores : defaults.show_risk_scores,
    ignore_whitespace: typeof raw.ignore_whitespace === 'boolean' ? raw.ignore_whitespace : defaults.ignore_whitespace,
    svg_view_mode: typeof raw.svg_view_mode === 'string' ? raw.svg_view_mode : defaults.svg_view_mode,
    last_image_mode: typeof raw.last_image_mode === 'string' ? raw.last_image_mode : defaults.last_image_mode,
    image_sxs_orientation: typeof raw.image_sxs_orientation === 'string' ? raw.image_sxs_orientation : defaults.image_sxs_orientation,
  };
  return UserPreferencesSchema.parse(merged);
}

export async function saveUserPreferences(prefs: Partial<UserPreferences>): Promise<void> {
  const db = await getDb();
  const current = await getUserPreferences();
  const merged = { ...current, ...prefs };
  await db.query(
    `INSERT INTO user_preferences (id, sort_mode, risk_sort_dimension, show_risk_scores, ignore_whitespace, svg_view_mode, last_image_mode, image_sxs_orientation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       sort_mode = EXCLUDED.sort_mode,
       risk_sort_dimension = EXCLUDED.risk_sort_dimension,
       show_risk_scores = EXCLUDED.show_risk_scores,
       ignore_whitespace = EXCLUDED.ignore_whitespace,
       svg_view_mode = EXCLUDED.svg_view_mode,
       last_image_mode = EXCLUDED.last_image_mode,
       image_sxs_orientation = EXCLUDED.image_sxs_orientation`,
    ['singleton', merged.sort_mode, merged.risk_sort_dimension, merged.show_risk_scores, merged.ignore_whitespace, merged.svg_view_mode, merged.last_image_mode, merged.image_sxs_orientation]
  );
}
