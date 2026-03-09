import { getDb } from './connection.js';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// --- AI Analyses ---

export interface AIAnalysis {
  id: string;
  review_id: string;
  analysis_type: string;
  status: string;
  error_message: string | null;
  progress_completed: number;
  progress_total: number;
  created_at: string;
  updated_at: string;
}

export async function createAnalysis(reviewId: string, analysisType: string): Promise<AIAnalysis> {
  const db = await getDb();
  const id = generateId();
  const result = await db.query<AIAnalysis>(
    `INSERT INTO ai_analyses (id, review_id, analysis_type, status)
     VALUES ($1, $2, $3, 'running') RETURNING *`,
    [id, reviewId, analysisType]
  );
  return result.rows[0];
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
  const result = await db.query<AIAnalysis>(
    `SELECT * FROM ai_analyses
     WHERE review_id = $1 AND analysis_type = $2
     ORDER BY created_at DESC LIMIT 1`,
    [reviewId, analysisType]
  );
  return result.rows[0];
}

// --- AI File Scores ---

export interface AIFileScore {
  id: string;
  analysis_id: string;
  review_file_id: string;
  file_path: string;
  sort_order: number;
  aggregate_score: number | null;
  rationale: string | null;
  dimension_scores: string | null; // JSON string
  notes: string | null; // JSON string
  created_at: string;
}

export async function saveFileScores(
  analysisId: string,
  scores: Array<{
    reviewFileId: string;
    filePath: string;
    sortOrder: number;
    aggregateScore: number | null;
    rationale: string | null;
    dimensionScores: Record<string, number> | null;
    notes: { overview: string; lines: Array<{ line: number; content: string }> } | null;
  }>
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
  scores: Array<{
    reviewFileId: string;
    filePath: string;
    sortOrder: number;
    aggregateScore: number | null;
    rationale: string | null;
    dimensionScores: Record<string, number> | null;
    notes: { overview: string; lines: Array<{ line: number; content: string }> } | null;
  }>
): Promise<void> {
  const db = await getDb();

  // Find which files already have scores for this analysis
  const existing = await db.query<{ file_path: string }>(
    'SELECT file_path FROM ai_file_scores WHERE analysis_id = $1',
    [analysisId]
  );
  const existingPaths = new Set(existing.rows.map(r => r.file_path));

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
  const result = await db.query<AIFileScore>(
    'SELECT * FROM ai_file_scores WHERE analysis_id = $1 ORDER BY sort_order',
    [analysisId]
  );
  return result.rows;
}

export async function getFileScoresForReview(reviewId: string, analysisType: string): Promise<AIFileScore[]> {
  const db = await getDb();
  const result = await db.query<AIFileScore>(
    `SELECT s.* FROM ai_file_scores s
     JOIN ai_analyses a ON s.analysis_id = a.id
     WHERE a.review_id = $1 AND a.analysis_type = $2 AND a.status IN ('completed', 'running')
     ORDER BY a.created_at DESC, s.sort_order
     LIMIT 1000`,
    [reviewId, analysisType]
  );
  // Only return scores from the latest analysis (completed or running)
  if (result.rows.length === 0) return [];
  const latestAnalysisId = result.rows[0].analysis_id;
  const rows = result.rows.filter(r => r.analysis_id === latestAnalysisId);

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
    const result = await db.query<AIFileScore>(
      `SELECT s.* FROM ai_file_scores s
       JOIN ai_analyses a ON s.analysis_id = a.id
       WHERE a.review_id = $1 AND a.analysis_type = $2 AND a.status = $3
         AND a.id != $4
       ORDER BY a.created_at DESC, s.sort_order
       LIMIT 1000`,
      [reviewId, analysisType, status, excludeAnalysisId]
    );
    if (result.rows.length > 0) {
      const latestAnalysisId = result.rows[0].analysis_id;
      return result.rows.filter(r => r.analysis_id === latestAnalysisId);
    }
  }
  return [];
}

// --- User Preferences ---

export interface UserPreferences {
  sort_mode: string;
  risk_sort_dimension: string;
  show_risk_scores: boolean;
}

export async function getUserPreferences(): Promise<UserPreferences> {
  const db = await getDb();
  const result = await db.query<UserPreferences>(
    'SELECT * FROM user_preferences WHERE id = $1',
    ['singleton']
  );
  if (result.rows.length === 0) {
    return { sort_mode: 'folder', risk_sort_dimension: 'aggregate', show_risk_scores: false };
  }
  return result.rows[0];
}

export async function saveUserPreferences(prefs: Partial<UserPreferences>): Promise<void> {
  const db = await getDb();
  const current = await getUserPreferences();
  const merged = { ...current, ...prefs };
  await db.query(
    `INSERT INTO user_preferences (id, sort_mode, risk_sort_dimension, show_risk_scores)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       sort_mode = EXCLUDED.sort_mode,
       risk_sort_dimension = EXCLUDED.risk_sort_dimension,
       show_risk_scores = EXCLUDED.show_risk_scores`,
    ['singleton', merged.sort_mode, merged.risk_sort_dimension, merged.show_risk_scores]
  );
}
