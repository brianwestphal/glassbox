/**
 * Typed API for review-level endpoints — list, complete, reopen, refresh,
 * delete, plus the gitignore-prompt nudges.
 */
import type { Review } from '../db/queries.js';
import { api } from './_runner.js';

export type ListReviewsResp = Review[];

export type GetCurrentReviewResp = Review | null;

export interface CompleteReviewResp {
  status: 'completed';
  exportPath: string;
  isCurrent: boolean;
  reviewId: string;
  gitignorePrompt: boolean;
}

export interface ReopenReviewResp { status: 'in_progress' }

export interface RefreshReviewResp {
  updated: number;
  added: number;
  stale: number;
  fileCount: number;
}

export interface DeleteReviewReq { id: string }
export interface DeleteReviewResp { ok: true }

export interface DeleteCompletedReviewsResp { deleted: number }
export interface DeleteAllReviewsResp { deleted: number }

export interface AddGitignoreEntryResp { ok: true }
export interface DismissGitignorePromptResp { ok: true }

export async function listReviews(): Promise<ListReviewsResp> {
  return api<ListReviewsResp>('/reviews');
}

export async function getCurrentReview(): Promise<GetCurrentReviewResp> {
  return api<GetCurrentReviewResp>('/review');
}

export async function completeReview(): Promise<CompleteReviewResp> {
  return api<CompleteReviewResp>('/review/complete', { method: 'POST' });
}

export async function reopenReview(): Promise<ReopenReviewResp> {
  return api<ReopenReviewResp>('/review/reopen', { method: 'POST' });
}

export async function refreshReview(): Promise<RefreshReviewResp> {
  return api<RefreshReviewResp>('/review/refresh', { method: 'POST' });
}

export async function deleteReview(req: DeleteReviewReq): Promise<DeleteReviewResp> {
  return api<DeleteReviewResp>(`/review/${req.id}`, { method: 'DELETE' });
}

export async function deleteCompletedReviews(): Promise<DeleteCompletedReviewsResp> {
  return api<DeleteCompletedReviewsResp>('/reviews/delete-completed', { method: 'POST' });
}

export async function deleteAllReviews(): Promise<DeleteAllReviewsResp> {
  return api<DeleteAllReviewsResp>('/reviews/delete-all', { method: 'POST' });
}

export async function addGitignoreEntry(): Promise<AddGitignoreEntryResp> {
  return api<AddGitignoreEntryResp>('/gitignore/add', { method: 'POST' });
}

export async function dismissGitignorePrompt(): Promise<DismissGitignorePromptResp> {
  return api<DismissGitignorePromptResp>('/gitignore/dismiss', { method: 'POST' });
}
