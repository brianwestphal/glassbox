/**
 * Typed API for `/channel/*` — the MCP channel that bridges the Glassbox
 * UI to Claude Code.
 */
import { z } from 'zod';

import { apiCall, OkResponseSchema } from './_runner.js';

export const GetChannelStatusRespSchema = z.object({
  enabled: z.boolean(),
  connected: z.boolean(),
});
export type GetChannelStatusResp = z.infer<typeof GetChannelStatusRespSchema>;

export const EnableChannelRespSchema = OkResponseSchema;
export type EnableChannelResp = z.infer<typeof EnableChannelRespSchema>;

export const DisableChannelRespSchema = OkResponseSchema;
export type DisableChannelResp = z.infer<typeof DisableChannelRespSchema>;

export const TriggerChannelReqSchema = z.object({
  message: z.string().refine(s => s.trim() !== '', 'message must be a non-empty string'),
});
export type TriggerChannelReq = z.infer<typeof TriggerChannelReqSchema>;

export const TriggerChannelRespSchema = OkResponseSchema;
export type TriggerChannelResp = z.infer<typeof TriggerChannelRespSchema>;

export const TriggerChannelErrorRespSchema = z.object({ error: z.string() });
export type TriggerChannelErrorResp = z.infer<typeof TriggerChannelErrorRespSchema>;

export const GetClaudeCheckRespSchema = z.object({
  installed: z.boolean(),
  version: z.string().nullable(),
  meetsMinimum: z.boolean(),
});
export type GetClaudeCheckResp = z.infer<typeof GetClaudeCheckRespSchema>;

const TriggerChannelRespOrErrorSchema = z.union([TriggerChannelRespSchema, TriggerChannelErrorRespSchema]);

export async function getChannelStatus(): Promise<GetChannelStatusResp> {
  return apiCall(GetChannelStatusRespSchema, '/channel/status');
}

export async function enableChannel(): Promise<EnableChannelResp> {
  return apiCall(EnableChannelRespSchema, '/channel/enable', { method: 'POST' });
}

export async function disableChannel(): Promise<DisableChannelResp> {
  return apiCall(DisableChannelRespSchema, '/channel/disable', { method: 'POST' });
}

export async function triggerChannel(req: TriggerChannelReq): Promise<TriggerChannelResp | TriggerChannelErrorResp> {
  return apiCall(TriggerChannelRespOrErrorSchema, '/channel/trigger', { method: 'POST', body: req });
}

export async function getClaudeCheck(): Promise<GetClaudeCheckResp> {
  return apiCall(GetClaudeCheckRespSchema, '/channel/claude-check');
}
