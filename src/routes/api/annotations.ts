import { Hono } from 'hono';

import {
  CreateAnnotationReqSchema,
  MoveAnnotationBodySchema,
  UpdateAnnotationBodySchema,
  UpdateRegionBodySchema,
} from '../../api/annotations.js';
import { addAnnotation, deleteAnnotation, deleteStaleAnnotations, getAnnotationsForReview, keepAllStaleAnnotations, markAnnotationCurrent, moveAnnotation, updateAnnotation, updateAnnotationRegion } from '../../db/queries.js';
import { scheduleAutoExport } from '../../export/auto-export.js';
import type { AppEnv } from '../../types.js';
import { parseBody, requirePathParam } from '../../utils/parseBody.js';
import { resolveReviewId } from '../../utils/resolveReviewId.js';

export const annotationsRoutes = new Hono<AppEnv>();

/** Trigger debounced auto-export after any annotation mutation. */
function autoExport(c: { get: (key: 'reviewId' | 'repoRoot') => string }) {
  scheduleAutoExport(c.get('reviewId'), c.get('repoRoot'));
}

annotationsRoutes.post('/annotations', async (c) => {
  const parsed = await parseBody(c, CreateAnnotationReqSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const annotation = await addAnnotation(
    body.reviewFileId, body.lineNumber, body.side, body.category, body.content, body.replyToNoteId,
    body.region, body.regions,
  );
  autoExport(c);
  return c.json(annotation, 201);
});

annotationsRoutes.patch('/annotations/:id', async (c) => {
  const id = requirePathParam(c, 'id');
  if (!id.ok) return id.response;
  const parsed = await parseBody(c, UpdateAnnotationBodySchema);
  if (!parsed.ok) return parsed.response;

  await updateAnnotation(id.data, parsed.data.content, parsed.data.category);
  autoExport(c);
  return c.json({ ok: true } as const);
});

annotationsRoutes.delete('/annotations/:id', async (c) => {
  const id = requirePathParam(c, 'id');
  if (!id.ok) return id.response;
  await deleteAnnotation(id.data);
  autoExport(c);
  return c.json({ ok: true } as const);
});

annotationsRoutes.patch('/annotations/:id/region', async (c) => {
  const id = requirePathParam(c, 'id');
  if (!id.ok) return id.response;
  const parsed = await parseBody(c, UpdateRegionBodySchema);
  if (!parsed.ok) return parsed.response;

  await updateAnnotationRegion(id.data, parsed.data.region);
  autoExport(c);
  return c.json({ ok: true } as const);
});

annotationsRoutes.patch('/annotations/:id/move', async (c) => {
  const id = requirePathParam(c, 'id');
  if (!id.ok) return id.response;
  const parsed = await parseBody(c, MoveAnnotationBodySchema);
  if (!parsed.ok) return parsed.response;

  await moveAnnotation(id.data, parsed.data.lineNumber, parsed.data.side);
  autoExport(c);
  return c.json({ ok: true } as const);
});

annotationsRoutes.post('/annotations/:id/keep', async (c) => {
  const id = requirePathParam(c, 'id');
  if (!id.ok) return id.response;
  await markAnnotationCurrent(id.data);
  autoExport(c);
  return c.json({ ok: true } as const);
});

annotationsRoutes.post('/annotations/stale/delete-all', async (c) => {
  const reviewId = resolveReviewId(c);
  await deleteStaleAnnotations(reviewId);
  autoExport(c);
  return c.json({ ok: true } as const);
});

annotationsRoutes.post('/annotations/stale/keep-all', async (c) => {
  const reviewId = resolveReviewId(c);
  await keepAllStaleAnnotations(reviewId);
  autoExport(c);
  return c.json({ ok: true } as const);
});

annotationsRoutes.get('/annotations/all', async (c) => {
  const reviewId = resolveReviewId(c);
  const annotations = await getAnnotationsForReview(reviewId);
  return c.json(annotations);
});
