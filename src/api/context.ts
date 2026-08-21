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

/** A revealed line's review notes, server-rendered (doc 20 §20.6, GB-1139). The
 *  client splices `html` into the diff after the line `line` when expanding a
 *  collapsed region, so previously-hidden notes surface. `html` is the rendered
 *  `.ai-note-row` markup (mode-independent — the client places it per view). */
export const ContextNoteSchema = z.object({
  line: z.number().int(),
  html: z.string(),
});
export type ContextNote = z.infer<typeof ContextNoteSchema>;

export const GetContextLinesRespSchema = z.object({
  lines: z.array(ContextLineSchema),
  /** Notes anchored inside the revealed range, keyed by new-side line. Omitted
   *  when none. Stale notes (snippet no longer matches) are excluded. */
  notes: z.array(ContextNoteSchema).optional(),
});
export type GetContextLinesResp = z.infer<typeof GetContextLinesRespSchema>;

export async function getContextLines(req: GetContextLinesReq): Promise<GetContextLinesResp> {
  return apiCall(
    GetContextLinesRespSchema,
    `/context/${req.fileId}${qs({ start: req.start, end: req.end })}`,
  );
}
