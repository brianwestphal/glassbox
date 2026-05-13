import { Hono } from 'hono';
import { resolve } from 'path';

import { getAnnotationCountsForReview, getAnnotationsForFile, getReviewFile, getReviewFiles, getStaleCountsForReview, updateFileStatus } from '../../db/queries.js';
import type { AppEnv } from '../../types.js';
import { openOS } from '../../utils/openOS.js';
import { resolveReviewId } from '../../utils/resolveReviewId.js';
import { checkEnum } from '../../utils/validate.js';

export const filesRoutes = new Hono<AppEnv>();

const VALID_FILE_STATUSES = ['pending', 'reviewed'] as const;

filesRoutes.get('/files', async (c) => {
  const reviewId = resolveReviewId(c);
  const [files, annotationCounts, staleCounts] = await Promise.all([
    getReviewFiles(reviewId),
    getAnnotationCountsForReview(reviewId),
    getStaleCountsForReview(reviewId),
  ]);
  return c.json({ files, annotationCounts, staleCounts });
});

filesRoutes.get('/files/:fileId', async (c) => {
  const file = await getReviewFile(c.req.param('fileId'));
  if (!file) return c.json({ error: 'Not found' }, 404);
  const annotations = await getAnnotationsForFile(file.id);
  return c.json({ file, annotations });
});

filesRoutes.patch('/files/:fileId/status', async (c) => {
  const { status } = await c.req.json<{ status: string }>();
  const v = checkEnum(status, 'status', VALID_FILE_STATUSES);
  if ('error' in v) return c.json({ error: v.error }, 400);

  await updateFileStatus(c.req.param('fileId'), v.ok);
  return c.json({ ok: true });
});

filesRoutes.post('/files/:fileId/reveal', async (c) => {
  const file = await getReviewFile(c.req.param('fileId'));
  if (!file) return c.json({ error: 'Not found' }, 404);
  const repoRoot = c.get('repoRoot');
  const fullPath = resolve(repoRoot, file.file_path);
  try {
    openOS(fullPath, 'reveal');
  } catch { /* ignore errors (e.g. file doesn't exist yet for added files) */ }
  return c.json({ ok: true });
});
