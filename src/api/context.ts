/**
 * Typed API for `/context/:fileId` — fetch a line range from the working
 * copy of a reviewed file, used by hunk expansion.
 */
import { z } from 'zod';

import { apiCall, qs } from './_runner.js';

export const ContextLineSchema = z.object({
  num: z.number().int(),
  content: z.string(),
});
export type ContextLine = z.infer<typeof ContextLineSchema>;

export const GetContextLinesReqSchema = z.object({
  fileId: z.string(),
  start: z.number().int(),
  end: z.number().int(),
});
export type GetContextLinesReq = z.infer<typeof GetContextLinesReqSchema>;

/** Query schema for the server route. `start`/`end` default to 1/20 so
 *  GET /context/:fileId with no params behaves like the legacy route. */
export const GetContextLinesQuerySchema = z.object({
  start: z.coerce.number().int().default(1),
  end: z.coerce.number().int().default(20),
});

export const GetContextLinesRespSchema = z.object({
  lines: z.array(ContextLineSchema),
});
export type GetContextLinesResp = z.infer<typeof GetContextLinesRespSchema>;

export async function getContextLines(req: GetContextLinesReq): Promise<GetContextLinesResp> {
  return apiCall(
    GetContextLinesRespSchema,
    `/context/${req.fileId}${qs({ start: req.start, end: req.end })}`,
  );
}
