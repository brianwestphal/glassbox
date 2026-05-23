/**
 * Typed API for the share-prompt nudge state (dismissed timestamp, total
 * open time tick).
 */
import { z } from 'zod';

import { apiCall, OkResponseSchema } from './_runner.js';

export const GetSharePromptStateRespSchema = z.object({
  dismissedAt: z.number().nullable(),
  totalOpenMs: z.number(),
});
export type GetSharePromptStateResp = z.infer<typeof GetSharePromptStateRespSchema>;

export const DismissSharePromptRespSchema = OkResponseSchema;
export type DismissSharePromptResp = z.infer<typeof DismissSharePromptRespSchema>;

export const TickSharePromptReqSchema = z.object({
  sessionMs: z.number(),
});
export type TickSharePromptReq = z.infer<typeof TickSharePromptReqSchema>;

export const TickSharePromptRespSchema = z.object({ totalOpenMs: z.number() });
export type TickSharePromptResp = z.infer<typeof TickSharePromptRespSchema>;

export async function getSharePromptState(): Promise<GetSharePromptStateResp> {
  return apiCall(GetSharePromptStateRespSchema, '/share-prompt/state');
}

export async function dismissSharePrompt(): Promise<DismissSharePromptResp> {
  return apiCall(DismissSharePromptRespSchema, '/share-prompt/dismiss', { method: 'POST' });
}

export async function tickSharePrompt(req: TickSharePromptReq): Promise<TickSharePromptResp> {
  return apiCall(TickSharePromptRespSchema, '/share-prompt/tick', { method: 'POST', body: req });
}
