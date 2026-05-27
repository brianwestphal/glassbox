import { Hono } from 'hono';
import { resolve } from 'path';

import { SetFileStatusBodySchema } from '../../api/files.js';
import { getAnnotationCountsForReview, getAnnotationsForFile, getReviewFile, getReviewFiles, getStaleCountsForReview, updateFileStatus } from '../../db/queries.js';
import type { AppEnv } from '../../types.js';
import { openOS } from '../../utils/openOS.js';
import { parseBody, requirePathParam } from '../../utils/parseBody.js';
import { resolveReviewId } from '../../utils/resolveReviewId.js';

export const filesRoutes = new Hono<AppEnv>();

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
  const fileId = requirePathParam(c, 'fileId');
  if (!fileId.ok) return fileId.response;
  const file = await getReviewFile(fileId.data);
  if (!file) return c.json({ error: 'Not found' }, 404);
  const annotations = await getAnnotationsForFile(file.id);
  return c.json({ file, annotations });
});

filesRoutes.patch('/files/:fileId/status', async (c) => {
  const fileId = requirePathParam(c, 'fileId');
  if (!fileId.ok) return fileId.response;
  const parsed = await parseBody(c, SetFileStatusBodySchema);
  if (!parsed.ok) return parsed.response;

  await updateFileStatus(fileId.data, parsed.data.status);
  return c.json({ ok: true } as const);
});

filesRoutes.post('/files/:fileId/reveal', async (c) => {
  const fileId = requirePathParam(c, 'fileId');
  if (!fileId.ok) return fileId.response;
  const file = await getReviewFile(fileId.data);
  if (!file) return c.json({ error: 'Not found' }, 404);
  const repoRoot = c.get('repoRoot');
  const fullPath = resolve(repoRoot, file.file_path);
  try {
    openOS(fullPath, 'reveal');
  } catch { /* ignore errors (e.g. file doesn't exist yet for added files) */ }
  return c.json({ ok: true } as const);
});
