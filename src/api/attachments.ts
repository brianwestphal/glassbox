/**
 * Typed API for `/annotations/:id/attachments` and `/attachments/:id`
 * (doc 25). Reviewer-uploaded files attached to any annotation.
 *
 * The upload caller posts `multipart/form-data` (a real File), so it can't go
 * through `apiCall()` (which JSON-encodes). It validates the JSON response
 * against `AttachmentSchema` by hand, keeping the same "fail loud at the
 * boundary" guarantee.
 */
import { z } from 'zod';

import { AttachmentSchema } from '../db/schemas.js';
import { apiCall, OkResponseSchema } from './_runner.js';

export { AttachmentSchema };
export type { Attachment } from '../db/schemas.js';

export const ListAttachmentsRespSchema = z.array(AttachmentSchema);
export type ListAttachmentsResp = z.infer<typeof ListAttachmentsRespSchema>;

export const UploadAttachmentRespSchema = AttachmentSchema;
export type UploadAttachmentResp = z.infer<typeof UploadAttachmentRespSchema>;

export type DeleteAttachmentResp = z.infer<typeof OkResponseSchema>;
export const DeleteAttachmentRespSchema = OkResponseSchema;

function currentReviewId(): string {
  if (typeof document === 'undefined') return '';
  return document.body.dataset.reviewId ?? '';
}

/** URL that serves an attachment's raw bytes (for `<img>`, the preview overlay,
 *  download). */
export function attachmentRawUrl(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/raw`;
}

export async function listAttachments(annotationId: string): Promise<ListAttachmentsResp> {
  return apiCall(ListAttachmentsRespSchema, `/annotations/${encodeURIComponent(annotationId)}/attachments`);
}

/** Every attachment in the current review — the client hydrates all annotation
 *  chips from one call rather than fetching per row. */
export async function listAllAttachments(): Promise<ListAttachmentsResp> {
  return apiCall(ListAttachmentsRespSchema, '/attachments/all');
}

/** Upload one file as an attachment on `annotationId`. */
export async function uploadAttachment(annotationId: string, file: File): Promise<UploadAttachmentResp> {
  const form = new FormData();
  form.append('file', file);
  const url = `/api/annotations/${encodeURIComponent(annotationId)}/attachments`
    + `?reviewId=${encodeURIComponent(currentReviewId())}`;
  const res = await fetch(url, { method: 'POST', body: form });
  const json: unknown = await res.json();
  const result = UploadAttachmentRespSchema.safeParse(json);
  if (!result.success) {
    const summary = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Attachment upload response failed validation: ${summary}`);
  }
  return result.data;
}

export async function deleteAttachment(id: string): Promise<DeleteAttachmentResp> {
  return apiCall(DeleteAttachmentRespSchema, `/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Open the attachment in the OS preview (macOS Quick Look; default opener
 *  elsewhere) via the local server. */
export async function quicklookAttachment(id: string): Promise<DeleteAttachmentResp> {
  return apiCall(DeleteAttachmentRespSchema, `/attachments/${encodeURIComponent(id)}/quicklook`, { method: 'POST' });
}
