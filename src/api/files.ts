/**
 * Typed API for `/files` endpoints — list / detail / status / reveal.
 */
import { z } from 'zod';

import { AnnotationSchema, ReviewFileSchema } from '../db/schemas.js';
import { apiCall, OkResponseSchema } from './_runner.js';

export const FileStatusSchema = z.enum(['pending', 'reviewed']);
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const ListFilesRespSchema = z.object({
  files: z.array(ReviewFileSchema),
  annotationCounts: z.record(z.string(), z.number()),
  staleCounts: z.record(z.string(), z.number()),
});
export type ListFilesResp = z.infer<typeof ListFilesRespSchema>;

export const GetFileReqSchema = z.object({ fileId: z.string() });
export type GetFileReq = z.infer<typeof GetFileReqSchema>;
export const GetFileRespSchema = z.object({
  file: ReviewFileSchema,
  annotations: z.array(AnnotationSchema),
});
export type GetFileResp = z.infer<typeof GetFileRespSchema>;

export const SetFileStatusReqSchema = z.object({
  fileId: z.string(),
  status: FileStatusSchema,
});
export type SetFileStatusReq = z.infer<typeof SetFileStatusReqSchema>;
export const SetFileStatusBodySchema = SetFileStatusReqSchema.omit({ fileId: true });

export type SetFileStatusResp = z.infer<typeof OkResponseSchema>;
export const SetFileStatusRespSchema = OkResponseSchema;

export const RevealFileReqSchema = z.object({ fileId: z.string() });
export type RevealFileReq = z.infer<typeof RevealFileReqSchema>;
export type RevealFileResp = z.infer<typeof OkResponseSchema>;
export const RevealFileRespSchema = OkResponseSchema;

export async function listFiles(): Promise<ListFilesResp> {
  return apiCall(ListFilesRespSchema, '/files');
}

export async function getFile(req: GetFileReq): Promise<GetFileResp> {
  return apiCall(GetFileRespSchema, `/files/${req.fileId}`);
}

export async function setFileStatus(req: SetFileStatusReq): Promise<SetFileStatusResp> {
  return apiCall(SetFileStatusRespSchema, `/files/${req.fileId}/status`, {
    method: 'PATCH',
    body: { status: req.status },
  });
}

export async function revealFile(req: RevealFileReq): Promise<RevealFileResp> {
  return apiCall(RevealFileRespSchema, `/files/${req.fileId}/reveal`, { method: 'POST' });
}
