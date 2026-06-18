/**
 * Typed API for `/annotations` endpoints. Schemas defined here are the
 * single source of truth for the wire shapes — the inferred TS types
 * flow to both the client callers and the server route handlers, and
 * runtime validation guards both ends.
 */
import { z } from 'zod';

import { AnnotationSchema } from '../db/schemas.js';
import { apiCall, OkResponseSchema } from './_runner.js';

// --- Schemas ---

export const AnnotationCategorySchema = z.enum([
  'bug', 'fix', 'style', 'pattern-follow', 'pattern-avoid', 'note', 'remember',
]);
export type AnnotationCategory = z.infer<typeof AnnotationCategorySchema>;

export const AnnotationSideSchema = z.enum(['old', 'new']);
export type AnnotationSide = z.infer<typeof AnnotationSideSchema>;

export const CreateAnnotationReqSchema = z.object({
  reviewFileId: z.string().min(1),
  lineNumber: z.number().int().min(1),
  side: AnnotationSideSchema,
  category: AnnotationCategorySchema,
  content: z.string().min(1),
  /** SARIF guid of the AI review note this annotation replies to (doc 20 threading). */
  replyToNoteId: z.string().optional(),
});
export type CreateAnnotationReq = z.infer<typeof CreateAnnotationReqSchema>;
export const CreateAnnotationRespSchema = AnnotationSchema;
export type CreateAnnotationResp = z.infer<typeof CreateAnnotationRespSchema>;

export const UpdateAnnotationReqSchema = z.object({
  id: z.string(),
  content: z.string().min(1),
  category: AnnotationCategorySchema,
});
export type UpdateAnnotationReq = z.infer<typeof UpdateAnnotationReqSchema>;

/** Server consumes this from the body (path captures `id` separately). */
export const UpdateAnnotationBodySchema = UpdateAnnotationReqSchema.omit({ id: true });

export type UpdateAnnotationResp = z.infer<typeof OkResponseSchema>;
export const UpdateAnnotationRespSchema = OkResponseSchema;

export const DeleteAnnotationReqSchema = z.object({ id: z.string() });
export type DeleteAnnotationReq = z.infer<typeof DeleteAnnotationReqSchema>;
export type DeleteAnnotationResp = z.infer<typeof OkResponseSchema>;
export const DeleteAnnotationRespSchema = OkResponseSchema;

export const MoveAnnotationReqSchema = z.object({
  id: z.string(),
  lineNumber: z.number().int().min(1),
  side: AnnotationSideSchema,
});
export type MoveAnnotationReq = z.infer<typeof MoveAnnotationReqSchema>;
export const MoveAnnotationBodySchema = MoveAnnotationReqSchema.omit({ id: true });
export type MoveAnnotationResp = z.infer<typeof OkResponseSchema>;
export const MoveAnnotationRespSchema = OkResponseSchema;

export const KeepAnnotationReqSchema = z.object({ id: z.string() });
export type KeepAnnotationReq = z.infer<typeof KeepAnnotationReqSchema>;
export type KeepAnnotationResp = z.infer<typeof OkResponseSchema>;
export const KeepAnnotationRespSchema = OkResponseSchema;

export type DeleteStaleAnnotationsResp = z.infer<typeof OkResponseSchema>;
export const DeleteStaleAnnotationsRespSchema = OkResponseSchema;

export type KeepAllStaleAnnotationsResp = z.infer<typeof OkResponseSchema>;
export const KeepAllStaleAnnotationsRespSchema = OkResponseSchema;

export const ListAllAnnotationsRespSchema = z.array(
  AnnotationSchema.extend({ file_path: z.string() }),
);
export type ListAllAnnotationsResp = z.infer<typeof ListAllAnnotationsRespSchema>;

// --- Typed callers (client-only runtime) ---

export async function createAnnotation(req: CreateAnnotationReq): Promise<CreateAnnotationResp> {
  return apiCall(CreateAnnotationRespSchema, '/annotations', { method: 'POST', body: req });
}

export async function updateAnnotation(req: UpdateAnnotationReq): Promise<UpdateAnnotationResp> {
  const { id, ...body } = req;
  return apiCall(UpdateAnnotationRespSchema, `/annotations/${id}`, { method: 'PATCH', body });
}

export async function deleteAnnotation(req: DeleteAnnotationReq): Promise<DeleteAnnotationResp> {
  return apiCall(DeleteAnnotationRespSchema, `/annotations/${req.id}`, { method: 'DELETE' });
}

export async function moveAnnotation(req: MoveAnnotationReq): Promise<MoveAnnotationResp> {
  const { id, ...body } = req;
  return apiCall(MoveAnnotationRespSchema, `/annotations/${id}/move`, { method: 'PATCH', body });
}

export async function keepAnnotation(req: KeepAnnotationReq): Promise<KeepAnnotationResp> {
  return apiCall(KeepAnnotationRespSchema, `/annotations/${req.id}/keep`, { method: 'POST' });
}

export async function deleteStaleAnnotations(): Promise<DeleteStaleAnnotationsResp> {
  return apiCall(DeleteStaleAnnotationsRespSchema, '/annotations/stale/delete-all', { method: 'POST' });
}

export async function keepAllStaleAnnotations(): Promise<KeepAllStaleAnnotationsResp> {
  return apiCall(KeepAllStaleAnnotationsRespSchema, '/annotations/stale/keep-all', { method: 'POST' });
}

export async function listAllAnnotations(): Promise<ListAllAnnotationsResp> {
  return apiCall(ListAllAnnotationsRespSchema, '/annotations/all');
}
