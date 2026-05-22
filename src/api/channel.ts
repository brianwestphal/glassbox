/**
 * Typed API for `/channel/*` — the MCP channel that bridges the Glassbox
 * UI to Claude Code.
 */
import { api } from './_runner.js';

export interface GetChannelStatusResp {
  enabled: boolean;
  connected: boolean;
}

export interface EnableChannelResp { ok: true }
export interface DisableChannelResp { ok: true }

export interface TriggerChannelReq { message: string }
export interface TriggerChannelResp { ok: true }
export interface TriggerChannelErrorResp { error: string }

export interface GetClaudeCheckResp {
  installed: boolean;
  version: string | null;
  meetsMinimum: boolean;
}

export async function getChannelStatus(): Promise<GetChannelStatusResp> {
  return api<GetChannelStatusResp>('/channel/status');
}

export async function enableChannel(): Promise<EnableChannelResp> {
  return api<EnableChannelResp>('/channel/enable', { method: 'POST' });
}

export async function disableChannel(): Promise<DisableChannelResp> {
  return api<DisableChannelResp>('/channel/disable', { method: 'POST' });
}

export async function triggerChannel(req: TriggerChannelReq): Promise<TriggerChannelResp | TriggerChannelErrorResp> {
  return api<TriggerChannelResp | TriggerChannelErrorResp>('/channel/trigger', { method: 'POST', body: req });
}

export async function getClaudeCheck(): Promise<GetClaudeCheckResp> {
  return api<GetClaudeCheckResp>('/channel/claude-check');
}
