/**
 * Typed API for `/files` endpoints — list / detail / status / reveal.
 */
import type { Annotation, ReviewFile } from '../db/queries.js';
import { api } from './_runner.js';

export type FileStatus = 'pending' | 'reviewed';

export interface ListFilesResp {
  files: ReviewFile[];
  annotationCounts: Record<string, number>;
  staleCounts: Record<string, number>;
}

export interface GetFileReq { fileId: string }
export interface GetFileResp {
  file: ReviewFile;
  annotations: Annotation[];
}

export interface SetFileStatusReq {
  fileId: string;
  status: FileStatus;
}
export interface SetFileStatusResp { ok: true }

export interface RevealFileReq { fileId: string }
export interface RevealFileResp { ok: true }

export async function listFiles(): Promise<ListFilesResp> {
  return api<ListFilesResp>('/files');
}

export async function getFile(req: GetFileReq): Promise<GetFileResp> {
  return api<GetFileResp>(`/files/${req.fileId}`);
}

export async function setFileStatus(req: SetFileStatusReq): Promise<SetFileStatusResp> {
  return api<SetFileStatusResp>(`/files/${req.fileId}/status`, {
    method: 'PATCH',
    body: { status: req.status },
  });
}

export async function revealFile(req: RevealFileReq): Promise<RevealFileResp> {
  return api<RevealFileResp>(`/files/${req.fileId}/reveal`, { method: 'POST' });
}
