/**
 * Typed API for AI-authored review notes (doc 20). Currently just the
 * reviewer-side **discard** of an outdated note (GB-907) — removing it from the
 * committed `.pr-notes/` store by its SARIF guid.
 */
import { z } from 'zod';

import { apiCall, qs } from './_runner.js';

export const DiscardReviewNoteReqSchema = z.object({
  guid: z.string().min(1),
  /** Repo-relative source file the note is on (scopes the shard search). */
  file: z.string().min(1),
});
export type DiscardReviewNoteReq = z.infer<typeof DiscardReviewNoteReqSchema>;

export const DiscardReviewNoteRespSchema = z.object({
  ok: z.boolean(),
  /** Whether a note was actually removed (false if it wasn't on disk, e.g. demo). */
  removed: z.boolean(),
});
export type DiscardReviewNoteResp = z.infer<typeof DiscardReviewNoteRespSchema>;

export async function discardReviewNote(req: DiscardReviewNoteReq): Promise<DiscardReviewNoteResp> {
  return apiCall(DiscardReviewNoteRespSchema, `/review-notes/${encodeURIComponent(req.guid)}${qs({ file: req.file })}`, { method: 'DELETE' });
}
