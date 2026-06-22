import { z } from 'zod';

import { getDb } from './connection.js';
import { generateId } from './ids.js';
import type { Attachment } from './schemas.js';
import { AttachmentSchema, parseRow, parseRows } from './schemas.js';

/** Attachment metadata to persist; bytes are written to disk separately
 *  (see `src/attachments/store.ts`). */
export interface NewAttachment {
  annotationId: string;
  originalFilename: string;
  storedPath: string;
  mimeType: string;
  size: number;
  sha256: string | null;
}

export async function createAttachment(a: NewAttachment): Promise<Attachment> {
  const db = await getDb();
  const id = generateId();
  const result = await db.query(
    `INSERT INTO attachments (id, annotation_id, original_filename, stored_path, mime_type, size, sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, a.annotationId, a.originalFilename, a.storedPath, a.mimeType, a.size, a.sha256],
  );
  const row = parseRow(AttachmentSchema, result.rows[0]);
  if (row === undefined) throw new Error('Failed to create attachment');
  return row;
}

export async function getAttachmentsForAnnotation(annotationId: string): Promise<Attachment[]> {
  const db = await getDb();
  const result = await db.query(
    'SELECT * FROM attachments WHERE annotation_id = $1 ORDER BY created_at ASC',
    [annotationId],
  );
  return parseRows(AttachmentSchema, result.rows);
}

export async function getAttachment(id: string): Promise<Attachment | undefined> {
  const db = await getDb();
  const result = await db.query('SELECT * FROM attachments WHERE id = $1', [id]);
  return parseRow(AttachmentSchema, result.rows[0]);
}

/** Delete an attachment row and return it (so the caller can remove the file). */
export async function deleteAttachment(id: string): Promise<Attachment | undefined> {
  const db = await getDb();
  const existing = await getAttachment(id);
  await db.query('DELETE FROM attachments WHERE id = $1', [id]);
  return existing;
}

/** Every attachment belonging to any annotation in a review, joined to the
 *  file path + line so callers (the markdown export, doc 25/6) can group them
 *  under the right feedback item. */
export async function getAttachmentsForReview(
  reviewId: string,
): Promise<Array<Attachment & { file_path: string; line_number: number }>> {
  const db = await getDb();
  const result = await db.query(
    `SELECT at.*, rf.file_path AS file_path, an.line_number AS line_number
       FROM attachments at
       JOIN annotations an ON an.id = at.annotation_id
       JOIN review_files rf ON rf.id = an.review_file_id
      WHERE rf.review_id = $1
      ORDER BY at.created_at ASC`,
    [reviewId],
  );
  return parseRows(
    AttachmentSchema.extend({ file_path: z.string(), line_number: z.number() }),
    result.rows,
  );
}
