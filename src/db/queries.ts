import { z } from 'zod';

import { getDb } from './connection.js';
import { generateId } from './ids.js';
import type { Annotation, AnnotationWithFilePath, ImageRegion, Review, ReviewFile } from './schemas.js';
import {
  AnnotationSchema,
  AnnotationWithFilePathSchema,
  parseRow,
  parseRows,
  ReviewFileSchema,
  ReviewSchema,
} from './schemas.js';

// Re-export the canonical types so existing call sites keep importing from
// `./queries.js`. The runtime shapes live in `./schemas.js`.
export type { Annotation, AnnotationWithFilePath, Review, ReviewFile } from './schemas.js';

// --- Reviews ---

export async function createReview(repoPath: string, repoName: string, mode: string, modeArgs?: string, headCommit?: string): Promise<Review> {
  const db = await getDb();
  const id = generateId();
  const result = await db.query(
    `INSERT INTO reviews (id, repo_path, repo_name, mode, mode_args, head_commit)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, repoPath, repoName, mode, modeArgs ?? null, headCommit ?? null]
  );
  const review = parseRow(ReviewSchema, result.rows[0]);
  if (review === undefined) throw new Error('createReview: INSERT did not return a row');
  return review;
}

export async function getReview(id: string): Promise<Review | undefined> {
  const db = await getDb();
  const result = await db.query('SELECT * FROM reviews WHERE id = $1', [id]);
  return parseRow(ReviewSchema, result.rows[0]);
}

export async function listReviews(repoPath?: string): Promise<Review[]> {
  const db = await getDb();
  if (repoPath !== undefined && repoPath !== '') {
    const result = await db.query(
      'SELECT * FROM reviews WHERE repo_path = $1 ORDER BY created_at DESC', [repoPath]
    );
    return parseRows(ReviewSchema, result.rows);
  }
  const result = await db.query('SELECT * FROM reviews ORDER BY created_at DESC');
  return parseRows(ReviewSchema, result.rows);
}

export async function updateReviewStatus(id: string, status: string): Promise<void> {
  const db = await getDb();
  await db.query('UPDATE reviews SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
}

export async function updateReviewHead(id: string, headCommit: string): Promise<void> {
  const db = await getDb();
  await db.query('UPDATE reviews SET head_commit = $1, updated_at = NOW() WHERE id = $2', [headCommit, id]);
}

const AttachmentPathSchema = z.object({ stored_path: z.string() }).loose();

export async function deleteReview(id: string): Promise<void> {
  const db = await getDb();
  // Collect the review's attachment files BEFORE any rows go away — the DB
  // cascade drops the `attachments` rows, taking the only record of each
  // `stored_path` with them, which previously leaked the bytes on disk
  // (doc 25; the per-annotation cleanup in `deleteAnnotation` never ran here
  // because the rows were deleted via raw SQL).
  const { deleteAttachmentFile } = await import('../attachments/store.js');
  const attachments = await db.query(
    `SELECT a.stored_path FROM attachments a
     JOIN annotations an ON an.id = a.annotation_id
     JOIN review_files rf ON rf.id = an.review_file_id
     WHERE rf.review_id = $1`,
    [id],
  );
  for (const row of parseRows(AttachmentPathSchema, attachments.rows)) {
    deleteAttachmentFile(row.stored_path);
  }
  // One transactional delete: `ON DELETE CASCADE` (ddl.ts) removes the
  // review_files → annotations → attachments rows with the review, atomically.
  await db.query('DELETE FROM reviews WHERE id = $1', [id]);
}

export async function getLatestInProgressReview(repoPath: string, mode: string, modeArgs?: string): Promise<Review | undefined> {
  const db = await getDb();
  const result = await db.query(
    `SELECT * FROM reviews
     WHERE repo_path = $1 AND mode = $2 AND status = 'in_progress'
     AND ($3::text IS NULL OR mode_args = $3)
     ORDER BY created_at DESC LIMIT 1`,
    [repoPath, mode, modeArgs ?? null]
  );
  return parseRow(ReviewSchema, result.rows[0]);
}

// --- Review Files ---

export async function addReviewFile(reviewId: string, filePath: string, diffData: string, differenceScore: number | null = null): Promise<ReviewFile> {
  const db = await getDb();
  const id = generateId();
  const result = await db.query(
    `INSERT INTO review_files (id, review_id, file_path, diff_data, difference_score)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, reviewId, filePath, diffData, differenceScore]
  );
  const file = parseRow(ReviewFileSchema, result.rows[0]);
  if (file === undefined) throw new Error('addReviewFile: INSERT did not return a row');
  return file;
}

export async function getReviewFiles(reviewId: string): Promise<ReviewFile[]> {
  const db = await getDb();
  const result = await db.query(
    'SELECT * FROM review_files WHERE review_id = $1 ORDER BY file_path', [reviewId]
  );
  return parseRows(ReviewFileSchema, result.rows);
}

export async function getReviewFile(id: string): Promise<ReviewFile | undefined> {
  const db = await getDb();
  const result = await db.query('SELECT * FROM review_files WHERE id = $1', [id]);
  return parseRow(ReviewFileSchema, result.rows[0]);
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

export async function addAnnotation(
  reviewFileId: string, lineNumber: number, side: string, category: string, content: string,
  replyToNoteId?: string, region?: ImageRegion, regions?: ImageRegion[],
): Promise<Annotation> {
  const db = await getDb();
  const id = generateId();
  // A reply marking several regions on a note's artifact stores a JSON array
  // (doc 25 / GB-959); a single image-diff region (doc 23) stores one object.
  const regionData = regions !== undefined && regions.length > 0
    ? JSON.stringify(regions)
    : region !== undefined ? JSON.stringify(region) : null;
  const result = await db.query(
    `INSERT INTO annotations (id, review_file_id, line_number, side, category, content, reply_to_note_id, region_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [id, reviewFileId, lineNumber, side, category, content, replyToNoteId ?? null, regionData]
  );
  const annotation = parseRow(AnnotationSchema, result.rows[0]);
  if (annotation === undefined) throw new Error('addAnnotation: INSERT did not return a row');
  return annotation;
}

export async function getAnnotationsForFile(reviewFileId: string): Promise<Annotation[]> {
  const db = await getDb();
  const result = await db.query(
    'SELECT * FROM annotations WHERE review_file_id = $1 ORDER BY line_number, created_at',
    [reviewFileId]
  );
  return parseRows(AnnotationSchema, result.rows);
}

export async function getAnnotationById(id: string): Promise<Annotation | undefined> {
  const db = await getDb();
  const result = await db.query('SELECT * FROM annotations WHERE id = $1', [id]);
  return parseRow(AnnotationSchema, result.rows[0]);
}

export async function getAnnotationsForReview(reviewId: string): Promise<AnnotationWithFilePath[]> {
  const db = await getDb();
  const result = await db.query(
    `SELECT a.*, rf.file_path FROM annotations a
     JOIN review_files rf ON a.review_file_id = rf.id
     WHERE rf.review_id = $1
     ORDER BY rf.file_path, a.line_number, a.created_at`,
    [reviewId]
  );
  return parseRows(AnnotationWithFilePathSchema, result.rows);
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
  // Remove any attachment bytes from disk before the row goes away (the DB
  // cascade drops the `attachments` rows, but not their files — doc 25).
  const { getAttachmentsForAnnotation } = await import('./attachment-queries.js');
  const { deleteAttachmentFile } = await import('../attachments/store.js');
  for (const att of await getAttachmentsForAnnotation(id)) deleteAttachmentFile(att.stored_path);
  await db.query('DELETE FROM annotations WHERE id = $1', [id]);
}

/** Rewrite an image-region annotation's geometry / per-side scope (doc 23 §23.10). */
export async function updateAnnotationRegion(id: string, region: ImageRegion): Promise<void> {
  const db = await getDb();
  await db.query(
    'UPDATE annotations SET region_data = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(region), id]
  );
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

const CountRowSchema = z.object({
  review_file_id: z.string(),
  count: z.string(),
});

export async function getStaleCountsForReview(reviewId: string): Promise<Record<string, number>> {
  const db = await getDb();
  const result = await db.query(
    `SELECT a.review_file_id, COUNT(*)::text as count FROM annotations a
     JOIN review_files rf ON a.review_file_id = rf.id
     WHERE rf.review_id = $1 AND a.is_stale = TRUE
     GROUP BY a.review_file_id`,
    [reviewId]
  );
  const rows = parseRows(CountRowSchema, result.rows);
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.review_file_id] = parseInt(row.count, 10);
  }
  return counts;
}

export async function getAnnotationCountsForReview(reviewId: string): Promise<Record<string, number>> {
  const db = await getDb();
  const result = await db.query(
    `SELECT a.review_file_id, COUNT(*)::text as count FROM annotations a
     JOIN review_files rf ON a.review_file_id = rf.id
     WHERE rf.review_id = $1
     GROUP BY a.review_file_id`,
    [reviewId]
  );
  const rows = parseRows(CountRowSchema, result.rows);
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.review_file_id] = parseInt(row.count, 10);
  }
  return counts;
}
