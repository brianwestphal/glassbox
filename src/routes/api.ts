import { Hono } from 'hono';

import {
  addAnnotation, deleteAnnotation, deleteReview,
deleteStaleAnnotations,   getAnnotationsForFile, getAnnotationsForReview,
  getReview, getReviewFile,
getReviewFiles,   getStaleCountsForReview,
keepAllStaleAnnotations,
listReviews,   markAnnotationCurrent, moveAnnotation,
updateAnnotation,   updateFileStatus, updateReviewStatus, } from '../db/queries.js';
import { addGlassboxToGitignore, deleteReviewExport, dismissGitignorePrompt,generateReviewExport, shouldPromptGitignore } from '../export/generate.js';
import { getFileContent } from '../git/diff.js';
import { parseOutline } from '../outline/parser.js';
import type { AppEnv } from '../types.js';

export const apiRoutes = new Hono<AppEnv>();

// Helper: resolve reviewId from query param or middleware
function resolveReviewId(c: { req: { query: (k: string) => string | undefined }; get: (k: string) => string }): string {
  return c.req.query('reviewId') ?? c.get('reviewId');
}

// --- Reviews ---

apiRoutes.get('/reviews', async (c) => {
  const repoRoot = c.get('repoRoot');
  const reviews = await listReviews(repoRoot);
  return c.json(reviews);
});

apiRoutes.get('/review', async (c) => {
  const reviewId = resolveReviewId(c);
  const review = await getReview(reviewId);
  return c.json(review);
});

apiRoutes.post('/review/complete', async (c) => {
  const reviewId = resolveReviewId(c);
  const currentReviewId = c.get('currentReviewId');
  const repoRoot = c.get('repoRoot');
  await updateReviewStatus(reviewId, 'completed');
  const isCurrent = reviewId === currentReviewId;
  const exportPath = await generateReviewExport(reviewId, repoRoot, isCurrent);
  const gitignorePrompt = shouldPromptGitignore(repoRoot);
  return c.json({ status: 'completed', exportPath, isCurrent, reviewId, gitignorePrompt });
});

apiRoutes.post('/gitignore/add', (c) => {
  const repoRoot = c.get('repoRoot');
  addGlassboxToGitignore(repoRoot);
  return c.json({ ok: true });
});

apiRoutes.post('/gitignore/dismiss', (c) => {
  const repoRoot = c.get('repoRoot');
  dismissGitignorePrompt(repoRoot);
  return c.json({ ok: true });
});

apiRoutes.post('/review/reopen', async (c) => {
  const reviewId = resolveReviewId(c);
  await updateReviewStatus(reviewId, 'in_progress');
  return c.json({ status: 'in_progress' });
});

apiRoutes.delete('/review/:id', async (c) => {
  const reviewId = c.req.param('id');
  const currentReviewId = c.get('currentReviewId');
  if (reviewId === currentReviewId) {
    return c.json({ error: 'Cannot delete the current review' }, 400);
  }
  const repoRoot = c.get('repoRoot');
  deleteReviewExport(reviewId, repoRoot);
  await deleteReview(reviewId);
  return c.json({ ok: true });
});

apiRoutes.post('/reviews/delete-completed', async (c) => {
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

apiRoutes.post('/reviews/delete-all', async (c) => {
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

// --- Files ---

apiRoutes.get('/files', async (c) => {
  const reviewId = resolveReviewId(c);
  const files = await getReviewFiles(reviewId);
  const annotationCounts: Record<string, number> = {};
  for (const file of files) {
    const annotations = await getAnnotationsForFile(file.id);
    annotationCounts[file.id] = annotations.length;
  }
  const staleCounts = await getStaleCountsForReview(reviewId);
  return c.json({ files, annotationCounts, staleCounts });
});

apiRoutes.get('/files/:fileId', async (c) => {
  const file = await getReviewFile(c.req.param('fileId'));
  if (!file) return c.json({ error: 'Not found' }, 404);
  const annotations = await getAnnotationsForFile(file.id);
  return c.json({ file, annotations });
});

apiRoutes.patch('/files/:fileId/status', async (c) => {
  const { status } = await c.req.json<{ status: string }>();
  await updateFileStatus(c.req.param('fileId'), status);
  return c.json({ ok: true });
});

// --- Annotations ---

apiRoutes.post('/annotations', async (c) => {
  const body = await c.req.json<{
    reviewFileId: string;
    lineNumber: number;
    side: string;
    category: string;
    content: string;
  }>();
  const annotation = await addAnnotation(
    body.reviewFileId, body.lineNumber, body.side, body.category, body.content
  );
  return c.json(annotation, 201);
});

apiRoutes.patch('/annotations/:id', async (c) => {
  const { content, category } = await c.req.json<{ content: string; category: string }>();
  await updateAnnotation(c.req.param('id'), content, category);
  return c.json({ ok: true });
});

apiRoutes.delete('/annotations/:id', async (c) => {
  await deleteAnnotation(c.req.param('id'));
  return c.json({ ok: true });
});

apiRoutes.patch('/annotations/:id/move', async (c) => {
  const { lineNumber, side } = await c.req.json<{ lineNumber: number; side: string }>();
  await moveAnnotation(c.req.param('id'), lineNumber, side);
  return c.json({ ok: true });
});

apiRoutes.post('/annotations/:id/keep', async (c) => {
  await markAnnotationCurrent(c.req.param('id'));
  return c.json({ ok: true });
});

apiRoutes.post('/annotations/stale/delete-all', async (c) => {
  const reviewId = resolveReviewId(c);
  await deleteStaleAnnotations(reviewId);
  return c.json({ ok: true });
});

apiRoutes.post('/annotations/stale/keep-all', async (c) => {
  const reviewId = resolveReviewId(c);
  await keepAllStaleAnnotations(reviewId);
  return c.json({ ok: true });
});

apiRoutes.get('/annotations/all', async (c) => {
  const reviewId = resolveReviewId(c);
  const annotations = await getAnnotationsForReview(reviewId);
  return c.json(annotations);
});

// --- Outline ---

apiRoutes.get('/outline/:fileId', async (c) => {
  const repoRoot = c.get('repoRoot');
  const file = await getReviewFile(c.req.param('fileId'));
  if (!file) return c.json({ error: 'Not found' }, 404);

  const diff = JSON.parse(file.diff_data ?? '{}') as { status?: string };
  const isDeleted = diff.status === 'deleted';

  let content = '';
  try {
    if (isDeleted) {
      content = getFileContent(file.file_path, 'HEAD', repoRoot);
    } else {
      content = getFileContent(file.file_path, 'working', repoRoot);
    }
  } catch {
    // File not accessible
  }

  if (!content) return c.json({ symbols: [] });

  const symbols = parseOutline(content, file.file_path);
  return c.json({ symbols });
});

// --- Context expansion ---

apiRoutes.get('/context/:fileId', async (c) => {
  const repoRoot = c.get('repoRoot');
  const file = await getReviewFile(c.req.param('fileId'));
  if (!file) return c.json({ error: 'Not found' }, 404);

  const startLine = parseInt(c.req.query('start') ?? '1', 10);
  const endLine = parseInt(c.req.query('end') ?? '20', 10);

  const content = getFileContent(file.file_path, 'working', repoRoot);
  const allLines = content.split('\n');
  const clampedStart = Math.max(1, startLine);
  const clampedEnd = Math.min(allLines.length, endLine);
  const lines = [];
  for (let i = clampedStart; i <= clampedEnd; i++) {
    lines.push({ num: i, content: allLines[i - 1] || '' });
  }
  return c.json({ lines });
});
