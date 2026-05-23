/**
 * Typed API for review-level endpoints — list, complete, reopen, refresh,
 * delete, plus the gitignore-prompt nudges.
 */
import { z } from 'zod';

import { ReviewSchema } from '../db/schemas.js';
import { apiCall, OkResponseSchema } from './_runner.js';

export const ListReviewsRespSchema = z.array(ReviewSchema);
export type ListReviewsResp = z.infer<typeof ListReviewsRespSchema>;

export const GetCurrentReviewRespSchema = ReviewSchema.nullable();
export type GetCurrentReviewResp = z.infer<typeof GetCurrentReviewRespSchema>;

export const CompleteReviewRespSchema = z.object({
  status: z.literal('completed'),
  exportPath: z.string(),
  isCurrent: z.boolean(),
  reviewId: z.string(),
  gitignorePrompt: z.boolean(),
});
export type CompleteReviewResp = z.infer<typeof CompleteReviewRespSchema>;

export const ReopenReviewRespSchema = z.object({ status: z.literal('in_progress') });
export type ReopenReviewResp = z.infer<typeof ReopenReviewRespSchema>;

export const RefreshReviewRespSchema = z.object({
  updated: z.number(),
  added: z.number(),
  stale: z.number(),
  fileCount: z.number(),
});
export type RefreshReviewResp = z.infer<typeof RefreshReviewRespSchema>;

export const DeleteReviewReqSchema = z.object({ id: z.string() });
export type DeleteReviewReq = z.infer<typeof DeleteReviewReqSchema>;
export const DeleteReviewRespSchema = OkResponseSchema;
export type DeleteReviewResp = z.infer<typeof DeleteReviewRespSchema>;

export const DeleteCompletedReviewsRespSchema = z.object({ deleted: z.number() });
export type DeleteCompletedReviewsResp = z.infer<typeof DeleteCompletedReviewsRespSchema>;

export const DeleteAllReviewsRespSchema = z.object({ deleted: z.number() });
export type DeleteAllReviewsResp = z.infer<typeof DeleteAllReviewsRespSchema>;

export const AddGitignoreEntryRespSchema = OkResponseSchema;
export type AddGitignoreEntryResp = z.infer<typeof AddGitignoreEntryRespSchema>;

export const DismissGitignorePromptRespSchema = OkResponseSchema;
export type DismissGitignorePromptResp = z.infer<typeof DismissGitignorePromptRespSchema>;

export async function listReviews(): Promise<ListReviewsResp> {
  return apiCall(ListReviewsRespSchema, '/reviews');
}

export async function getCurrentReview(): Promise<GetCurrentReviewResp> {
  return apiCall(GetCurrentReviewRespSchema, '/review');
}

export async function completeReview(): Promise<CompleteReviewResp> {
  return apiCall(CompleteReviewRespSchema, '/review/complete', { method: 'POST' });
}

export async function reopenReview(): Promise<ReopenReviewResp> {
  return apiCall(ReopenReviewRespSchema, '/review/reopen', { method: 'POST' });
}

export async function refreshReview(): Promise<RefreshReviewResp> {
  return apiCall(RefreshReviewRespSchema, '/review/refresh', { method: 'POST' });
}

export async function deleteReview(req: DeleteReviewReq): Promise<DeleteReviewResp> {
  return apiCall(DeleteReviewRespSchema, `/review/${req.id}`, { method: 'DELETE' });
}

export async function deleteCompletedReviews(): Promise<DeleteCompletedReviewsResp> {
  return apiCall(DeleteCompletedReviewsRespSchema, '/reviews/delete-completed', { method: 'POST' });
}

export async function deleteAllReviews(): Promise<DeleteAllReviewsResp> {
  return apiCall(DeleteAllReviewsRespSchema, '/reviews/delete-all', { method: 'POST' });
}

export async function addGitignoreEntry(): Promise<AddGitignoreEntryResp> {
  return apiCall(AddGitignoreEntryRespSchema, '/gitignore/add', { method: 'POST' });
}

export async function dismissGitignorePrompt(): Promise<DismissGitignorePromptResp> {
  return apiCall(DismissGitignorePromptRespSchema, '/gitignore/dismiss', { method: 'POST' });
}
