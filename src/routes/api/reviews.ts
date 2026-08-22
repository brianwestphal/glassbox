import { Hono } from 'hono';

import { OpenCommitReviewReqSchema } from '../../api/reviews.js';
import { deleteReview, getAnnotationsForReview, getReview, listReviews, updateReviewStatus } from '../../db/queries.js';
import { deleteReviewExport, generateReviewExport } from '../../export/generate.js';
import { runOnCompleteHook } from '../../export/on-complete-hook.js';
import { getFileDiffs, getHeadCommit, parseModeString } from '../../git/diff.js';
import { notifyReviewCompleted } from '../../plugins/index.js';
import { CommitNotFoundError, openCommitReview } from '../../review-open/commit-review.js';
import { updateReviewDiffs } from '../../review-update.js';
import type { AppEnv } from '../../types.js';
import { errorResponse, parseBody, requirePathParam } from '../../utils/parseBody.js';
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

  // Fire the --on-complete hook (doc 2 / GB-974) AFTER the review is completed +
  // exported, so a failing/absent hook never affects the review state. The JSON
  // export (doc 6) sits next to the markdown — same path, .json extension.
  const hook = await runOnCompleteHook(c.get('onCompleteCommand') ?? null, {
    reviewId,
    repoRoot,
    jsonPath: exportPath.replace(/\.md$/, '.json'),
    markdownPath: exportPath,
  });

  // Fire plugin onReviewCompleted hooks (doc 31) with the completed review + its
  // annotations + the export path. Fail-soft: after the review is already
  // completed/exported, so a hook error never affects the response.
  try {
    const completed = await getReview(reviewId);
    if (completed !== undefined) {
      await notifyReviewCompleted(completed, await getAnnotationsForReview(reviewId), exportPath);
    }
  } catch { /* fail-soft */ }

  return c.json({ status: 'completed' as const, exportPath, isCurrent, reviewId, hook });
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
  if (!review) return errorResponse(c, 'Review not found', 404);

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

// Open a commit as a review at runtime (doc 34, GB-1144). Creates — or reuses —
// a `commit:<sha>` review for the given sha in this server's repo and returns
// its id, so a review note's origin-commit label can jump into that commit's
// full context. Reviews are otherwise only created by the CLI; this is the one
// route that creates one.
reviewsRoutes.post('/reviews/from-commit', async (c) => {
  const parsed = await parseBody(c, OpenCommitReviewReqSchema);
  if (!parsed.ok) return parsed.response;
  const repoRoot = c.get('repoRoot');
  try {
    const result = await openCommitReview(repoRoot, parsed.data.sha);
    return c.json(result);
  } catch (err) {
    if (err instanceof CommitNotFoundError) return errorResponse(c, err.message, 404);
    throw err;
  }
});

reviewsRoutes.delete('/review/:id', async (c) => {
  const idParam = requirePathParam(c, 'id');
  if (!idParam.ok) return idParam.response;
  const reviewId = idParam.data;
  const currentReviewId = c.get('currentReviewId');
  if (reviewId === currentReviewId) {
    return errorResponse(c, 'Cannot delete the current review', 400);
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
