import { getDb } from './connection.js';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// --- Reviews ---

export interface Review {
  id: string;
  repo_path: string;
  repo_name: string;
  mode: string;
  mode_args: string | null;
  head_commit: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function createReview(repoPath: string, repoName: string, mode: string, modeArgs?: string, headCommit?: string): Promise<Review> {
  const db = await getDb();
  const id = generateId();
  const result = await db.query<Review>(
    `INSERT INTO reviews (id, repo_path, repo_name, mode, mode_args, head_commit)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, repoPath, repoName, mode, modeArgs ?? null, headCommit ?? null]
  );
  return result.rows[0];
}

export async function getReview(id: string): Promise<Review | undefined> {
  const db = await getDb();
  const result = await db.query<Review>('SELECT * FROM reviews WHERE id = $1', [id]);
  return result.rows[0];
}

export async function listReviews(repoPath?: string): Promise<Review[]> {
  const db = await getDb();
  if (repoPath !== undefined && repoPath !== '') {
    const result = await db.query<Review>(
      'SELECT * FROM reviews WHERE repo_path = $1 ORDER BY created_at DESC', [repoPath]
    );
    return result.rows;
  }
  const result = await db.query<Review>('SELECT * FROM reviews ORDER BY created_at DESC');
  return result.rows;
}

export async function updateReviewStatus(id: string, status: string): Promise<void> {
  const db = await getDb();
  await db.query('UPDATE reviews SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
}

export async function updateReviewHead(id: string, headCommit: string): Promise<void> {
  const db = await getDb();
  await db.query('UPDATE reviews SET head_commit = $1, updated_at = NOW() WHERE id = $2', [headCommit, id]);
}

export async function deleteReview(id: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM annotations WHERE review_file_id IN (SELECT id FROM review_files WHERE review_id = $1)', [id]);
  await db.query('DELETE FROM review_files WHERE review_id = $1', [id]);
  await db.query('DELETE FROM reviews WHERE id = $1', [id]);
}

export async function getLatestInProgressReview(repoPath: string, mode: string, modeArgs?: string): Promise<Review | undefined> {
  const db = await getDb();
  const result = await db.query<Review>(
    `SELECT * FROM reviews
     WHERE repo_path = $1 AND mode = $2 AND status = 'in_progress'
     AND ($3::text IS NULL OR mode_args = $3)
     ORDER BY created_at DESC LIMIT 1`,
    [repoPath, mode, modeArgs ?? null]
  );
  return result.rows[0];
}

// --- Review Files ---

export interface ReviewFile {
  id: string;
  review_id: string;
  file_path: string;
  status: string;
  diff_data: string | null;
  created_at: string;
}

export async function addReviewFile(reviewId: string, filePath: string, diffData: string): Promise<ReviewFile> {
  const db = await getDb();
  const id = generateId();
  const result = await db.query<ReviewFile>(
    `INSERT INTO review_files (id, review_id, file_path, diff_data)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, reviewId, filePath, diffData]
  );
  return result.rows[0];
}

export async function getReviewFiles(reviewId: string): Promise<ReviewFile[]> {
  const db = await getDb();
  const result = await db.query<ReviewFile>(
    'SELECT * FROM review_files WHERE review_id = $1 ORDER BY file_path', [reviewId]
  );
  return result.rows;
}

export async function getReviewFile(id: string): Promise<ReviewFile | undefined> {
  const db = await getDb();
  const result = await db.query<ReviewFile>('SELECT * FROM review_files WHERE id = $1', [id]);
  return result.rows[0];
}

export async function updateFileStatus(id: string, status: string): Promise<void> {
  const db = await getDb();
  await db.query('UPDATE review_files SET status = $1 WHERE id = $2', [status, id]);
}

export async function updateFileDiff(id: string, diffData: string): Promise<void> {
  const db = await getDb();
  await db.query('UPDATE review_files SET diff_data = $1 WHERE id = $2', [diffData, id]);
}

export async function deleteReviewFile(id: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM annotations WHERE review_file_id = $1', [id]);
  await db.query('DELETE FROM review_files WHERE id = $1', [id]);
}

// --- Annotations ---

export interface Annotation {
  id: string;
  review_file_id: string;
  line_number: number;
  side: string;
  category: string;
  content: string;
  is_stale: boolean;
  original_content: string | null;
  created_at: string;
  updated_at: string;
}

export async function addAnnotation(
  reviewFileId: string, lineNumber: number, side: string, category: string, content: string
): Promise<Annotation> {
  const db = await getDb();
  const id = generateId();
  const result = await db.query<Annotation>(
    `INSERT INTO annotations (id, review_file_id, line_number, side, category, content)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, reviewFileId, lineNumber, side, category, content]
  );
  return result.rows[0];
}

export async function getAnnotationsForFile(reviewFileId: string): Promise<Annotation[]> {
  const db = await getDb();
  const result = await db.query<Annotation>(
    'SELECT * FROM annotations WHERE review_file_id = $1 ORDER BY line_number, created_at',
    [reviewFileId]
  );
  return result.rows;
}

export async function getAnnotationsForReview(reviewId: string): Promise<(Annotation & { file_path: string })[]> {
  const db = await getDb();
  const result = await db.query<Annotation & { file_path: string }>(
    `SELECT a.*, rf.file_path FROM annotations a
     JOIN review_files rf ON a.review_file_id = rf.id
     WHERE rf.review_id = $1
     ORDER BY rf.file_path, a.line_number, a.created_at`,
    [reviewId]
  );
  return result.rows;
}

export async function updateAnnotation(id: string, content: string, category: string): Promise<void> {
  const db = await getDb();
  await db.query(
    'UPDATE annotations SET content = $1, category = $2, updated_at = NOW() WHERE id = $3',
    [content, category, id]
  );
}

export async function deleteAnnotation(id: string): Promise<void> {
  const db = await getDb();
  await db.query('DELETE FROM annotations WHERE id = $1', [id]);
}

export async function moveAnnotation(id: string, lineNumber: number, side: string): Promise<void> {
  const db = await getDb();
  await db.query(
    'UPDATE annotations SET line_number = $1, side = $2, is_stale = FALSE, original_content = NULL, updated_at = NOW() WHERE id = $3',
    [lineNumber, side, id]
  );
}

export async function markAnnotationStale(id: string, originalContent: string | null): Promise<void> {
  const db = await getDb();
  await db.query(
    'UPDATE annotations SET is_stale = TRUE, original_content = $1, updated_at = NOW() WHERE id = $2',
    [originalContent, id]
  );
}

export async function markAnnotationCurrent(id: string): Promise<void> {
  const db = await getDb();
  await db.query(
    'UPDATE annotations SET is_stale = FALSE, original_content = NULL, updated_at = NOW() WHERE id = $1',
    [id]
  );
}

export async function deleteStaleAnnotations(reviewId: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `DELETE FROM annotations WHERE is_stale = TRUE AND review_file_id IN
     (SELECT id FROM review_files WHERE review_id = $1)`,
    [reviewId]
  );
}

export async function keepAllStaleAnnotations(reviewId: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE annotations SET is_stale = FALSE, original_content = NULL, updated_at = NOW()
     WHERE is_stale = TRUE AND review_file_id IN
     (SELECT id FROM review_files WHERE review_id = $1)`,
    [reviewId]
  );
}

export async function getStaleCountsForReview(reviewId: string): Promise<Record<string, number>> {
  const db = await getDb();
  const result = await db.query<{ review_file_id: string; count: string }>(
    `SELECT a.review_file_id, COUNT(*)::text as count FROM annotations a
     JOIN review_files rf ON a.review_file_id = rf.id
     WHERE rf.review_id = $1 AND a.is_stale = TRUE
     GROUP BY a.review_file_id`,
    [reviewId]
  );
  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.review_file_id] = parseInt(row.count, 10);
  }
  return counts;
}
