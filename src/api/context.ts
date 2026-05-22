/**
 * Typed API for `/context/:fileId` — fetch a line range from the working
 * copy of a reviewed file, used by hunk expansion.
 */
import { api, qs } from './_runner.js';

export interface ContextLine { num: number; content: string }

export interface GetContextLinesReq {
  fileId: string;
  start: number;
  end: number;
}
export interface GetContextLinesResp { lines: ContextLine[] }

export async function getContextLines(req: GetContextLinesReq): Promise<GetContextLinesResp> {
  return api<GetContextLinesResp>(`/context/${req.fileId}${qs({ start: req.start, end: req.end })}`);
}
