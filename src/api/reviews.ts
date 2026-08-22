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

/** Outcome of the `--on-complete` hook (doc 2 / GB-974). `ran: false` when no
 *  hook was configured. */
export const OnCompleteHookResultSchema = z.object({
  ran: z.boolean(),
  ok: z.boolean(),
  exitCode: z.number().nullable(),
  error: z.string().optional(),
});

export const CompleteReviewRespSchema = z.object({
  status: z.literal('completed'),
  exportPath: z.string(),
  isCurrent: z.boolean(),
  reviewId: z.string(),
  hook: OnCompleteHookResultSchema,
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

/** Open a commit as a review at runtime (doc 34, GB-1144). */
export const OpenCommitReviewReqSchema = z.object({ sha: z.string().min(1) });
export type OpenCommitReviewReq = z.infer<typeof OpenCommitReviewReqSchema>;
export const OpenCommitReviewRespSchema = z.object({
  reviewId: z.string(),
  fileCount: z.number(),
  created: z.boolean(),
});
export type OpenCommitReviewResp = z.infer<typeof OpenCommitReviewRespSchema>;

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

export async function createReviewFromCommit(req: OpenCommitReviewReq): Promise<OpenCommitReviewResp> {
  return apiCall(OpenCommitReviewRespSchema, '/reviews/from-commit', { method: 'POST', body: req });
}
