import { z } from 'zod';

import { ReviewFileSchema } from '../db/schemas.js';
import { apiCall } from './_runner.js';

export const DifftoolStatusRespSchema = z.object({
  tool: z.string().nullable(),
  cmd: z.string().nullable(),
  isGlassbox: z.boolean(),
});
export type DifftoolStatusResp = z.infer<typeof DifftoolStatusRespSchema>;

export const RegisterDifftoolReqSchema = z.object({
  force: z.boolean().optional(),
});
export type RegisterDifftoolReq = z.infer<typeof RegisterDifftoolReqSchema>;

// NB: must be a plain `z.union`, NOT `z.discriminatedUnion('ok', …)` — zod v4
// rejects a discriminated union whose branches share a discriminator literal
// value at parse time with `Duplicate discriminator value "false"`. Both
// failure branches here have `ok: false`, so they'd collide. The plain
// `z.union` resolves variants by trial parse against each branch and the
// inferred TS type is just as tight (GB-852).
export const RegisterDifftoolRespSchema = z.union([
  z.object({ ok: z.literal(true), replacedTool: z.string().nullable() }),
  z.object({ ok: z.literal(false), reason: z.literal('conflict'), currentTool: z.string() }),
  z.object({ ok: z.literal(false), reason: z.literal('git-failed'), message: z.string() }),
]);
export type RegisterDifftoolResp = z.infer<typeof RegisterDifftoolRespSchema>;

export const UnregisterDifftoolRespSchema = z.object({
  ok: z.literal(true),
  removed: z.boolean(),
});
export type UnregisterDifftoolResp = z.infer<typeof UnregisterDifftoolRespSchema>;

// --- Accumulating difftool session (doc 19) ---

/**
 * Append one file to the active difftool review. Content is base64-encoded so
 * the wire shape carries arbitrary bytes (text and binary alike) through JSON;
 * the server diffs the raw content with the `--diff` engine (FR-19.7). The
 * server resolves the target review from the running session, so no reviewId is
 * needed — the wrapper posts this without one.
 */
export const AppendDifftoolFileReqSchema = z.object({
  path: z.string().min(1),
  oldContentB64: z.string(),
  newContentB64: z.string(),
});
export type AppendDifftoolFileReq = z.infer<typeof AppendDifftoolFileReqSchema>;

export const AppendDifftoolFileRespSchema = z.object({
  ok: z.literal(true),
  fileId: z.string(),
});
export type AppendDifftoolFileResp = z.infer<typeof AppendDifftoolFileRespSchema>;

/** Live-list poll (FR-19.8): the current file set plus an `active` flag the
 *  client uses to detect end-of-session. */
export const DifftoolPollRespSchema = z.object({
  active: z.boolean(),
  files: z.array(ReviewFileSchema),
  annotationCounts: z.record(z.string(), z.number()),
  staleCounts: z.record(z.string(), z.number()),
});
export type DifftoolPollResp = z.infer<typeof DifftoolPollRespSchema>;

export const DifftoolEndRespSchema = z.object({ ok: z.literal(true) });
export type DifftoolEndResp = z.infer<typeof DifftoolEndRespSchema>;

export async function getDifftoolStatus(): Promise<DifftoolStatusResp> {
  return apiCall(DifftoolStatusRespSchema, '/difftool/status');
}

/** Client live-list poll. Returns `active: false` once the session has ended. */
export async function pollDifftool(): Promise<DifftoolPollResp> {
  return apiCall(DifftoolPollRespSchema, '/difftool/poll');
}

/** End the difftool session from the UI ("Done"): releases the held wrapper so
 *  `git difftool` returns cleanly, then the server tears itself down. */
export async function endDifftool(): Promise<DifftoolEndResp> {
  return apiCall(DifftoolEndRespSchema, '/difftool/end', { method: 'POST' });
}

export async function registerDifftool(req: RegisterDifftoolReq = {}): Promise<RegisterDifftoolResp> {
  return apiCall(RegisterDifftoolRespSchema, '/difftool/register', { method: 'POST', body: req });
}

export async function unregisterDifftool(): Promise<UnregisterDifftoolResp> {
  return apiCall(UnregisterDifftoolRespSchema, '/difftool/unregister', { method: 'POST' });
}
