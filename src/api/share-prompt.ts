/**
 * Typed API for the share-prompt nudge state (dismissed timestamp, total
 * open time tick).
 */
import { api } from './_runner.js';

export interface GetSharePromptStateResp {
  dismissedAt: number | null;
  totalOpenMs: number;
}

export interface DismissSharePromptResp { ok: true }

export interface TickSharePromptReq { sessionMs: number }
export interface TickSharePromptResp { totalOpenMs: number }

export async function getSharePromptState(): Promise<GetSharePromptStateResp> {
  return api<GetSharePromptStateResp>('/share-prompt/state');
}

export async function dismissSharePrompt(): Promise<DismissSharePromptResp> {
  return api<DismissSharePromptResp>('/share-prompt/dismiss', { method: 'POST' });
}

export async function tickSharePrompt(req: TickSharePromptReq): Promise<TickSharePromptResp> {
  return api<TickSharePromptResp>('/share-prompt/tick', { method: 'POST', body: req });
}
