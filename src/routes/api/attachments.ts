import { readFileSync, statSync } from 'node:fs';

import { Hono } from 'hono';

import { deleteAttachmentFile, writeAttachmentFile } from '../../attachments/store.js';
import { createAttachment, deleteAttachment, getAttachment, getAttachmentsForAnnotation, getAttachmentsForReview } from '../../db/attachment-queries.js';
import { generateId } from '../../db/ids.js';
import { getAnnotationById } from '../../db/queries.js';
import type { AppEnv } from '../../types.js';
import { mimeForFilename } from '../../utils/mime.js';
import { openOS } from '../../utils/openOS.js';
import { errorResponse, requirePathParam } from '../../utils/parseBody.js';
import { resolveReviewId } from '../../utils/resolveReviewId.js';

export const attachmentsRoutes = new Hono<AppEnv>();

/** GET /attachments/all — every attachment in the current review (the client
 *  hydrates all annotation chips in one call). */
attachmentsRoutes.get('/attachments/all', async (c) => {
  const reviewId = resolveReviewId(c);
  const all = await getAttachmentsForReview(reviewId);
  // Drop the export-only join columns; the client only needs the attachment rows.
  return c.json(all.map((a) => ({
    id: a.id,
    annotation_id: a.annotation_id,
    original_filename: a.original_filename,
    stored_path: a.stored_path,
    mime_type: a.mime_type,
    size: a.size,
    sha256: a.sha256,
    created_at: a.created_at,
  })));
});

// 50 MB cap, matching the kind of files (logs, screenshots, short clips) a
// reviewer realistically attaches to a comment (doc 25).
const MAX_ATTACHMENT_BYTES = 50_000_000;

/** GET /annotations/:id/attachments — list one annotation's attachments. */
attachmentsRoutes.get('/annotations/:id/attachments', async (c) => {
  const idParam = requirePathParam(c, 'id');
  if (!idParam.ok) return idParam.response;
  return c.json(await getAttachmentsForAnnotation(idParam.data));
});

/** POST /annotations/:id/attachments — upload one file (multipart, field `file`). */
attachmentsRoutes.post('/annotations/:id/attachments', async (c) => {
  const idParam = requirePathParam(c, 'id');
  if (!idParam.ok) return idParam.response;
  const annotationId = idParam.data;

  const annotation = await getAnnotationById(annotationId);
  if (annotation === undefined) return errorResponse(c, 'Annotation not found', 404);

  let body: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    body = await c.req.parseBody();
  } catch {
    return errorResponse(c, 'Expected multipart/form-data', 400);
  }
  const file = body['file'];
  if (!(file instanceof File)) return errorResponse(c, 'Missing file field', 400);
  if (file.size > MAX_ATTACHMENT_BYTES) return errorResponse(c, 'Attachment too large (max 50 MB)', 413);

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return errorResponse(c, 'Empty file', 400);

  const originalFilename = file.name === '' ? 'attachment' : file.name;
  const id = generateId();
  let stored;
  try {
    stored = writeAttachmentFile(id, originalFilename, bytes);
  } catch {
    return errorResponse(c, 'Could not store attachment', 500);
  }

  const mimeType = file.type !== '' ? file.type : mimeForFilename(originalFilename);
  const attachment = await createAttachment({
    annotationId,
    originalFilename,
    storedPath: stored.storedPath,
    mimeType,
    size: stored.size,
    sha256: stored.sha256,
  });
  return c.json(attachment);
});

/** GET /attachments/:id/raw — serve an attachment's bytes. */
attachmentsRoutes.get('/attachments/:id/raw', async (c) => {
  const idParam = requirePathParam(c, 'id');
  if (!idParam.ok) return idParam.response;
  const attachment = await getAttachment(idParam.data);
  if (attachment === undefined) return c.text('Not found', 404);
  try {
    const stat = statSync(attachment.stored_path);
    if (!stat.isFile()) return c.text('Not found', 404);
    const bytes = readFileSync(attachment.stored_path);
    // `inline` so images/PDFs preview in-tab; the filename rides along for
    // a "save as". The plain `filename=` is restricted to a safe ASCII subset
    // (control chars / non-ASCII / quotes / backslashes made undici reject the
    // whole header — a request-time 500); the RFC 5987 `filename*` carries the
    // full original name UTF-8-encoded for capable browsers (GB-1085).
    const asciiName = attachment.original_filename
       
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '_');
    const utf8Name = encodeURIComponent(attachment.original_filename);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': attachment.mime_type,
        'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    return c.text('Not found', 404);
  }
});

/** POST /attachments/:id/quicklook — open the file in the OS preview (macOS
 *  Quick Look via `qlmanage -p`; default opener elsewhere). The Node server is
 *  always local (CLI or Tauri sidecar), so it can shell out directly (doc 25). */
attachmentsRoutes.post('/attachments/:id/quicklook', async (c) => {
  const idParam = requirePathParam(c, 'id');
  if (!idParam.ok) return idParam.response;
  const attachment = await getAttachment(idParam.data);
  if (attachment === undefined) return errorResponse(c, 'Attachment not found', 404);
  try {
    statSync(attachment.stored_path);
  } catch {
    return errorResponse(c, 'Attachment file missing', 404);
  }
  try {
    openOS(attachment.stored_path, 'quicklook');
  } catch {
    return errorResponse(c, 'Could not open preview', 500);
  }
  return c.json({ ok: true } as const);
});

/** DELETE /attachments/:id — remove the row and the file. */
attachmentsRoutes.delete('/attachments/:id', async (c) => {
  const idParam = requirePathParam(c, 'id');
  if (!idParam.ok) return idParam.response;
  const removed = await deleteAttachment(idParam.data);
  if (removed !== undefined) {
    deleteAttachmentFile(removed.stored_path);
  }
  return c.json({ ok: true } as const);
});
