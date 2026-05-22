/**
 * Typed API for `/outline/:fileId` and `/symbol-definition`. Powers the
 * file outline breadcrumb and go-to-definition.
 */
import type { OutlineSymbol } from '../outline/parser.js';
import { api, qs } from './_runner.js';

export interface SymbolDef {
  fileId: string | null;
  filePath: string;
  name: string;
  kind: string;
  line: number;
}

export interface GetOutlineReq { fileId: string }
export interface GetOutlineResp { symbols: OutlineSymbol[] }

export interface FindSymbolDefinitionReq {
  name: string;
  currentFileId?: string;
}
export interface FindSymbolDefinitionResp { definitions: SymbolDef[] }

export async function getOutline(req: GetOutlineReq): Promise<GetOutlineResp> {
  return api<GetOutlineResp>(`/outline/${req.fileId}`);
}

export async function findSymbolDefinition(req: FindSymbolDefinitionReq): Promise<FindSymbolDefinitionResp> {
  return api<FindSymbolDefinitionResp>(`/symbol-definition${qs({ name: req.name, currentFileId: req.currentFileId })}`);
}
