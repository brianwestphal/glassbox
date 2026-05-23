import { Hono } from 'hono';

import { deleteReview, getReview, listReviews, updateReviewStatus } from '../../db/queries.js';
import { addGlassboxToGitignore, deleteReviewExport, dismissGitignorePrompt, generateReviewExport, shouldPromptGitignore } from '../../export/generate.js';
import { getFileDiffs, getHeadCommit, parseModeString } from '../../git/diff.js';
import { updateReviewDiffs } from '../../review-update.js';
import type { AppEnv } from '../../types.js';
import { resolveReviewId } from '../../utils/resolveReviewId.js';

export const reviewsRoutes = new Hono<AppEnv>();

reviewsRoutes.get('/reviews', async (c) => {
  const repoRoot = c.get('repoRoot');
  const reviews = await listReviews(repoRoot);
  return c.json(reviews);
});

reviewsRoutes.get('/review', async (c) => {
  const reviewId = resolveReviewId(c);
  const review = await getReview(reviewId);
  return c.json(review ?? null);
});

reviewsRoutes.post('/review/complete', async (c) => {
  const reviewId = resolveReviewId(c);
  const currentReviewId = c.get('currentReviewId');
  const repoRoot = c.get('repoRoot');
  await updateReviewStatus(reviewId, 'completed');
  const isCurrent = reviewId === currentReviewId;
  const exportPath = await generateReviewExport(reviewId, repoRoot, isCurrent);
  const gitignorePrompt = shouldPromptGitignore(repoRoot);
  return c.json({ status: 'completed' as const, exportPath, isCurrent, reviewId, gitignorePrompt });
});

reviewsRoutes.post('/gitignore/add', (c) => {
  const repoRoot = c.get('repoRoot');
  addGlassboxToGitignore(repoRoot);
  return c.json({ ok: true } as const);
});

reviewsRoutes.post('/gitignore/dismiss', (c) => {
  const repoRoot = c.get('repoRoot');
  dismissGitignorePrompt(repoRoot);
  return c.json({ ok: true } as const);
});

reviewsRoutes.post('/review/reopen', async (c) => {
  const reviewId = resolveReviewId(c);
  await updateReviewStatus(reviewId, 'in_progress');
  return c.json({ status: 'in_progress' as const });
});

reviewsRoutes.post('/review/refresh', async (c) => {
  const reviewId = resolveReviewId(c);
  const repoRoot = c.get('repoRoot');
  const review = await getReview(reviewId);
  if (!review) return c.json({ error: 'Review not found' }, 404);

  const mode = parseModeString(review.mode);
  const headCommit = getHeadCommit(repoRoot);
  const diffs = getFileDiffs(mode, repoRoot);
  const result = await updateReviewDiffs(reviewId, diffs, headCommit);

  return c.json({
    updated: result.updated,
    added: result.added,
    stale: result.stale,
    fileCount: diffs.length,
  });
});

reviewsRoutes.delete('/review/:id', async (c) => {
  const reviewId = c.req.param('id');
  const currentReviewId = c.get('currentReviewId');
  if (reviewId === currentReviewId) {
    return c.json({ error: 'Cannot delete the current review' }, 400);
  }
  const repoRoot = c.get('repoRoot');
  deleteReviewExport(reviewId, repoRoot);
  await deleteReview(reviewId);
  return c.json({ ok: true } as const);
});

reviewsRoutes.post('/reviews/delete-completed', async (c) => {
  const currentReviewId = c.get('currentReviewId');
  const repoRoot = c.get('repoRoot');
  const reviews = await listReviews(repoRoot);
  const toDelete = reviews.filter(r => r.status === 'completed' && r.id !== currentReviewId);
  for (const r of toDelete) {
    deleteReviewExport(r.id, repoRoot);
    await deleteReview(r.id);
  }
  return c.json({ deleted: toDelete.length });
});

reviewsRoutes.post('/reviews/delete-all', async (c) => {
  const currentReviewId = c.get('currentReviewId');
  const repoRoot = c.get('repoRoot');
  const reviews = await listReviews(repoRoot);
  const toDelete = reviews.filter(r => r.id !== currentReviewId);
  for (const r of toDelete) {
    deleteReviewExport(r.id, repoRoot);
    await deleteReview(r.id);
  }
  return c.json({ deleted: toDelete.length });
});
