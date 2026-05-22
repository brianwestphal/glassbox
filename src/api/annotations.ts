/**
 * Typed API for `/annotations` endpoints. Shared between client (typed
 * callers) and server (`import type` of the request / response shapes
 * for use in `c.req.json<>` and `c.json<>`).
 *
 * See `src/api/index.ts` for the flat `apis` namespace that aggregates
 * every module's callers.
 */
import type { Annotation } from '../db/queries.js';
import { api } from './_runner.js';

// --- Types ---

export type AnnotationCategory = 'bug' | 'fix' | 'style' | 'pattern-follow' | 'pattern-avoid' | 'note' | 'remember';
export type AnnotationSide = 'old' | 'new';

export interface CreateAnnotationReq {
  reviewFileId: string;
  lineNumber: number;
  side: AnnotationSide;
  category: AnnotationCategory;
  content: string;
}
export type CreateAnnotationResp = Annotation;

export interface UpdateAnnotationReq {
  id: string;
  content: string;
  category: AnnotationCategory;
}
export interface UpdateAnnotationResp { ok: true }

export interface DeleteAnnotationReq { id: string }
export interface DeleteAnnotationResp { ok: true }

export interface MoveAnnotationReq {
  id: string;
  lineNumber: number;
  side: AnnotationSide;
}
export interface MoveAnnotationResp { ok: true }

export interface KeepAnnotationReq { id: string }
export interface KeepAnnotationResp { ok: true }

export interface DeleteStaleAnnotationsResp { ok: true }
export interface KeepAllStaleAnnotationsResp { ok: true }

export type ListAllAnnotationsResp = Annotation[];

// --- Typed callers (client-only runtime) ---

export async function createAnnotation(req: CreateAnnotationReq): Promise<CreateAnnotationResp> {
  return api<CreateAnnotationResp>('/annotations', { method: 'POST', body: req });
}

export async function updateAnnotation(req: UpdateAnnotationReq): Promise<UpdateAnnotationResp> {
  const { id, ...body } = req;
  return api<UpdateAnnotationResp>(`/annotations/${id}`, { method: 'PATCH', body });
}

export async function deleteAnnotation(req: DeleteAnnotationReq): Promise<DeleteAnnotationResp> {
  return api<DeleteAnnotationResp>(`/annotations/${req.id}`, { method: 'DELETE' });
}

export async function moveAnnotation(req: MoveAnnotationReq): Promise<MoveAnnotationResp> {
  const { id, ...body } = req;
  return api<MoveAnnotationResp>(`/annotations/${id}/move`, { method: 'PATCH', body });
}

export async function keepAnnotation(req: KeepAnnotationReq): Promise<KeepAnnotationResp> {
  return api<KeepAnnotationResp>(`/annotations/${req.id}/keep`, { method: 'POST' });
}

export async function deleteStaleAnnotations(): Promise<DeleteStaleAnnotationsResp> {
  return api<DeleteStaleAnnotationsResp>('/annotations/stale/delete-all', { method: 'POST' });
}

export async function keepAllStaleAnnotations(): Promise<KeepAllStaleAnnotationsResp> {
  return api<KeepAllStaleAnnotationsResp>('/annotations/stale/keep-all', { method: 'POST' });
}

export async function listAllAnnotations(): Promise<ListAllAnnotationsResp> {
  return api<ListAllAnnotationsResp>('/annotations/all');
}
