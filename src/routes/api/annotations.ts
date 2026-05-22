import { Hono } from 'hono';

import type {
  CreateAnnotationReq,
  CreateAnnotationResp,
  DeleteAnnotationResp,
  DeleteStaleAnnotationsResp,
  KeepAllStaleAnnotationsResp,
  KeepAnnotationResp,
  ListAllAnnotationsResp,
  MoveAnnotationReq,
  UpdateAnnotationReq,
  UpdateAnnotationResp,
} from '../../api/index.js';
import { addAnnotation, deleteAnnotation, deleteStaleAnnotations, getAnnotationsForReview, keepAllStaleAnnotations, markAnnotationCurrent, moveAnnotation, updateAnnotation } from '../../db/queries.js';
import { scheduleAutoExport } from '../../export/auto-export.js';
import type { AppEnv } from '../../types.js';
import { resolveReviewId } from '../../utils/resolveReviewId.js';
import { checkEnum, isNonEmptyString } from '../../utils/validate.js';

export const annotationsRoutes = new Hono<AppEnv>();

const VALID_CATEGORIES = ['bug', 'fix', 'style', 'pattern-follow', 'pattern-avoid', 'note', 'remember'] as const;
const VALID_SIDES = ['old', 'new'] as const;

/** Trigger debounced auto-export after any annotation mutation. */
function autoExport(c: { get: (key: 'reviewId' | 'repoRoot') => string }) {
  scheduleAutoExport(c.get('reviewId'), c.get('repoRoot'));
}

annotationsRoutes.post('/annotations', async (c) => {
  const body = await c.req.json<CreateAnnotationReq>();

  if (!isNonEmptyString(body.reviewFileId)) {
    return c.json({ error: 'reviewFileId must be a non-empty string' }, 400);
  }
  if (typeof body.lineNumber !== 'number' || !Number.isInteger(body.lineNumber) || body.lineNumber < 1) {
    return c.json({ error: 'lineNumber must be a positive integer' }, 400);
  }
  const sideCheck = checkEnum(body.side, 'side', VALID_SIDES);
  if ('error' in sideCheck) return c.json({ error: sideCheck.error }, 400);
  const categoryCheck = checkEnum(body.category, 'category', VALID_CATEGORIES);
  if ('error' in categoryCheck) return c.json({ error: categoryCheck.error }, 400);
  if (!isNonEmptyString(body.content)) {
    return c.json({ error: 'content must be a non-empty string' }, 400);
  }

  const annotation = await addAnnotation(
    body.reviewFileId, body.lineNumber, sideCheck.ok, categoryCheck.ok, body.content
  );
  autoExport(c);
  return c.json<CreateAnnotationResp>(annotation, 201);
});

annotationsRoutes.patch('/annotations/:id', async (c) => {
  const { content, category } = await c.req.json<Omit<UpdateAnnotationReq, 'id'>>();

  if (!isNonEmptyString(content)) {
    return c.json({ error: 'content must be a non-empty string' }, 400);
  }
  const categoryCheck = checkEnum(category, 'category', VALID_CATEGORIES);
  if ('error' in categoryCheck) return c.json({ error: categoryCheck.error }, 400);

  await updateAnnotation(c.req.param('id'), content, categoryCheck.ok);
  autoExport(c);
  return c.json<UpdateAnnotationResp>({ ok: true });
});

annotationsRoutes.delete('/annotations/:id', async (c) => {
  await deleteAnnotation(c.req.param('id'));
  autoExport(c);
  return c.json<DeleteAnnotationResp>({ ok: true });
});

annotationsRoutes.patch('/annotations/:id/move', async (c) => {
  const { lineNumber, side } = await c.req.json<Omit<MoveAnnotationReq, 'id'>>();

  if (typeof lineNumber !== 'number' || !Number.isInteger(lineNumber) || lineNumber < 1) {
    return c.json({ error: 'lineNumber must be a positive integer' }, 400);
  }
  const sideCheck = checkEnum(side, 'side', VALID_SIDES);
  if ('error' in sideCheck) return c.json({ error: sideCheck.error }, 400);

  await moveAnnotation(c.req.param('id'), lineNumber, sideCheck.ok);
  autoExport(c);
  return c.json<UpdateAnnotationResp>({ ok: true });
});

annotationsRoutes.post('/annotations/:id/keep', async (c) => {
  await markAnnotationCurrent(c.req.param('id'));
  autoExport(c);
  return c.json<KeepAnnotationResp>({ ok: true });
});

annotationsRoutes.post('/annotations/stale/delete-all', async (c) => {
  const reviewId = resolveReviewId(c);
  await deleteStaleAnnotations(reviewId);
  autoExport(c);
  return c.json<DeleteStaleAnnotationsResp>({ ok: true });
});

annotationsRoutes.post('/annotations/stale/keep-all', async (c) => {
  const reviewId = resolveReviewId(c);
  await keepAllStaleAnnotations(reviewId);
  autoExport(c);
  return c.json<KeepAllStaleAnnotationsResp>({ ok: true });
});

annotationsRoutes.get('/annotations/all', async (c) => {
  const reviewId = resolveReviewId(c);
  const annotations = await getAnnotationsForReview(reviewId);
  return c.json<ListAllAnnotationsResp>(annotations);
});
