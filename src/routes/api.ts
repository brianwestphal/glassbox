import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import {
  getReview, getReviewFiles, getReviewFile,
  getAnnotationsForFile, getAnnotationsForReview,
  addAnnotation, updateAnnotation, deleteAnnotation,
  updateFileStatus, updateReviewStatus, listReviews, deleteReview,
} from '../db/queries.js';
import { generateReviewExport, deleteReviewExport } from '../export/generate.js';
import { getFileContent } from '../git/diff.js';

export const apiRoutes = new Hono<AppEnv>();

// Helper: resolve reviewId from query param or middleware
function resolveReviewId(c: { req: { query: (k: string) => string | undefined }; get: (k: string) => string }): string {
  return c.req.query('reviewId') || c.get('reviewId') as string;
}

// --- Reviews ---

apiRoutes.get('/reviews', async (c) => {
  const repoRoot = c.get('repoRoot') as string;
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
  const currentReviewId = c.get('currentReviewId') as string;
  const repoRoot = c.get('repoRoot') as string;
  await updateReviewStatus(reviewId, 'completed');
  const isCurrent = reviewId === currentReviewId;
  const exportPath = await generateReviewExport(reviewId, repoRoot, isCurrent);
  return c.json({ status: 'completed', exportPath, isCurrent, reviewId });
});

apiRoutes.post('/review/reopen', async (c) => {
  const reviewId = resolveReviewId(c);
  await updateReviewStatus(reviewId, 'in_progress');
  return c.json({ status: 'in_progress' });
});

apiRoutes.delete('/review/:id', async (c) => {
  const reviewId = c.req.param('id');
  const currentReviewId = c.get('currentReviewId') as string;
  if (reviewId === currentReviewId) {
    return c.json({ error: 'Cannot delete the current review' }, 400);
  }
  const repoRoot = c.get('repoRoot') as string;
  deleteReviewExport(reviewId, repoRoot);
  await deleteReview(reviewId);
  return c.json({ ok: true });
});

apiRoutes.post('/reviews/delete-completed', async (c) => {
  const currentReviewId = c.get('currentReviewId') as string;
  const repoRoot = c.get('repoRoot') as string;
  const reviews = await listReviews(repoRoot);
  const toDelete = reviews.filter(r => r.status === 'completed' && r.id !== currentReviewId);
  for (const r of toDelete) {
    deleteReviewExport(r.id, repoRoot);
    await deleteReview(r.id);
  }
  return c.json({ deleted: toDelete.length });
});

apiRoutes.post('/reviews/delete-all', async (c) => {
  const currentReviewId = c.get('currentReviewId') as string;
  const repoRoot = c.get('repoRoot') as string;
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
  return c.json({ files, annotationCounts });
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

apiRoutes.get('/annotations/all', async (c) => {
  const reviewId = resolveReviewId(c);
  const annotations = await getAnnotationsForReview(reviewId);
  return c.json(annotations);
});

// --- Context expansion ---

apiRoutes.get('/context/:fileId', async (c) => {
  const repoRoot = c.get('repoRoot') as string;
  const file = await getReviewFile(c.req.param('fileId'));
  if (!file) return c.json({ error: 'Not found' }, 404);

  const startLine = parseInt(c.req.query('start') || '1', 10);
  const endLine = parseInt(c.req.query('end') || '20', 10);

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
