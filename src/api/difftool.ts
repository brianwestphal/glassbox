import { z } from 'zod';

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

export async function getDifftoolStatus(): Promise<DifftoolStatusResp> {
  return apiCall(DifftoolStatusRespSchema, '/difftool/status');
}

export async function registerDifftool(req: RegisterDifftoolReq = {}): Promise<RegisterDifftoolResp> {
  return apiCall(RegisterDifftoolRespSchema, '/difftool/register', { method: 'POST', body: req });
}

export async function unregisterDifftool(): Promise<UnregisterDifftoolResp> {
  return apiCall(UnregisterDifftoolRespSchema, '/difftool/unregister', { method: 'POST' });
}
