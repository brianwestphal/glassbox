/**
 * Typed API for `/outline/:fileId` and `/symbol-definition`. Powers the
 * file outline breadcrumb and go-to-definition.
 */
import { z } from 'zod';

/**
 * Recursive outline-symbol schema. Mirrors `OutlineSymbol` from
 * `src/outline/parser.ts` — that file owns the canonical TS type
 * (re-exported here); this module owns the runtime validation schema.
 */
import type { OutlineSymbol } from '../outline/parser.js';
import { apiCall, qs } from './_runner.js';

export type { OutlineSymbol } from '../outline/parser.js';

const baseOutlineSymbol = z.object({
  name: z.string(),
  kind: z.enum(['class', 'function']),
  line: z.number(),
  endLine: z.number(),
});
export const OutlineSymbolSchema: z.ZodType<OutlineSymbol> = baseOutlineSymbol.extend({
  children: z.lazy(() => z.array(OutlineSymbolSchema)),
});

export const SymbolDefSchema = z.object({
  fileId: z.string().nullable(),
  filePath: z.string(),
  name: z.string(),
  kind: z.string(),
  line: z.number(),
});
export type SymbolDef = z.infer<typeof SymbolDefSchema>;

export const GetOutlineReqSchema = z.object({ fileId: z.string() });
export type GetOutlineReq = z.infer<typeof GetOutlineReqSchema>;

export const GetOutlineRespSchema = z.object({ symbols: z.array(OutlineSymbolSchema) });
export type GetOutlineResp = z.infer<typeof GetOutlineRespSchema>;

export const FindSymbolDefinitionReqSchema = z.object({
  name: z.string(),
  currentFileId: z.string().optional(),
});
export type FindSymbolDefinitionReq = z.infer<typeof FindSymbolDefinitionReqSchema>;

export const FindSymbolDefinitionRespSchema = z.object({
  definitions: z.array(SymbolDefSchema),
});
export type FindSymbolDefinitionResp = z.infer<typeof FindSymbolDefinitionRespSchema>;

export async function getOutline(req: GetOutlineReq): Promise<GetOutlineResp> {
  return apiCall(GetOutlineRespSchema, `/outline/${req.fileId}`);
}

export async function findSymbolDefinition(req: FindSymbolDefinitionReq): Promise<FindSymbolDefinitionResp> {
  return apiCall(
    FindSymbolDefinitionRespSchema,
    `/symbol-definition${qs({ name: req.name, currentFileId: req.currentFileId })}`,
  );
}
