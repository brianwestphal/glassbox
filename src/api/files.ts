/**
 * Typed API for `/files` endpoints — list / detail / status / reveal.
 */
import { z } from 'zod';

import { AnnotationSchema, ReviewFileSchema } from '../db/schemas.js';
import { apiCall, OkResponseSchema } from './_runner.js';

export const FileStatusSchema = z.enum(['pending', 'reviewed']);
export type FileStatus = z.infer<typeof FileStatusSchema>;

/**
 * Per-file ground-truth presentation metadata (doc 26 §26.1). Present only for
 * ground-truth reviews; lets the sidebar read like a list of named comparisons
 * (label + what the expected image represents) rather than a raw `actual/` file
 * tree. An entry exists for every ground-truth file even when both fields are
 * absent, so the map's keys also signal "this is a ground-truth review".
 */
export const GroundTruthMetaSchema = z.object({
  label: z.string().optional(),
  expectedKind: z.enum(['spec', 'reference', 'previous-actual']).optional(),
  // Set / multi-step flow grouping (doc 26 §26.3, P3b). Present only on files
  // that belong to a `version: 2` manifest set step; singles omit them. Lets the
  // sidebar render set groups with ordered step rows + an aggregate score.
  setIndex: z.number().optional(),
  setLabel: z.string().optional(),
  stepIndex: z.number().optional(),
  stepCount: z.number().optional(),
});
export type GroundTruthMeta = z.infer<typeof GroundTruthMetaSchema>;

export const ListFilesRespSchema = z.object({
  files: z.array(ReviewFileSchema),
  annotationCounts: z.record(z.string(), z.number()),
  staleCounts: z.record(z.string(), z.number()),
  /** Keyed by review-file id; omitted/empty for non-ground-truth reviews. */
  groundTruth: z.record(z.string(), GroundTruthMetaSchema).optional(),
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

export const GetFilePathReqSchema = z.object({ fileId: z.string() });
export type GetFilePathReq = z.infer<typeof GetFilePathReqSchema>;
export const GetFilePathRespSchema = z.object({
  relativePath: z.string(),
  absolutePath: z.string(),
});
export type GetFilePathResp = z.infer<typeof GetFilePathRespSchema>;

export const OpenFileReqSchema = z.object({ fileId: z.string() });
export type OpenFileReq = z.infer<typeof OpenFileReqSchema>;
export type OpenFileResp = z.infer<typeof OkResponseSchema>;
export const OpenFileRespSchema = OkResponseSchema;

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

export async function getFilePath(req: GetFilePathReq): Promise<GetFilePathResp> {
  return apiCall(GetFilePathRespSchema, `/files/${req.fileId}/path`);
}

export async function openFileInEditor(req: OpenFileReq): Promise<OpenFileResp> {
  return apiCall(OpenFileRespSchema, `/files/${req.fileId}/open`, { method: 'POST' });
}
