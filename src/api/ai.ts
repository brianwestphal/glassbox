/**
 * Typed API for the AI subsystem — config, key management, analysis
 * runs, and per-user preferences. The server routes mount these under
 * `/api/ai/*`.
 */
import type { AIModel, AIPlatform } from '../ai/models.js';
import { api, qs } from './_runner.js';

// Re-export so the flat `apis` namespace + named imports can pull these
// directly from the API layer without round-tripping through ai/models.js.
export type { AIModel,AIPlatform } from '../ai/models.js';

// --- Config ---

export type KeySource = 'env' | 'keychain' | 'config' | null;
export type KeyStorage = 'keychain' | 'config';

export interface AIConfigResp {
  platform: AIPlatform;
  model: string;
  keyConfigured: boolean;
  keySource: KeySource;
  guidedReview: GuidedReviewConfigShape;
}

export interface GuidedReviewConfigShape {
  enabled: boolean;
  topics: string[];
}

export interface SaveAIConfigReq {
  platform: AIPlatform;
  model: string;
  guidedReview?: GuidedReviewConfigShape;
}
export interface SaveAIConfigResp { ok: true }

export interface ListAIModelsResp {
  platforms: Record<AIPlatform, string>;
  models: Record<AIPlatform, AIModel[]>;
}

export interface AIKeyStatusEntry {
  configured: boolean;
  source: KeySource;
}

export interface AvailablePlatformEntry {
  platform: AIPlatform;
  source: 'env' | 'keychain' | 'config';
}

export interface GetAIKeyStatusResp {
  status: Record<AIPlatform, AIKeyStatusEntry>;
  keychainAvailable: boolean;
  keychainLabel: string;
  availablePlatforms: AvailablePlatformEntry[];
}

export interface SaveAIKeyReq {
  platform: AIPlatform;
  key: string;
  storage: KeyStorage;
}
export interface SaveAIKeyResp { ok: true }

export interface DeleteAIKeyReq { platform: AIPlatform }
export interface DeleteAIKeyResp { ok: true }

// --- Analysis ---

export type AnalysisType = 'risk' | 'narrative' | 'guided';
/** Server-side analysis row status — narrow to known values but allow a
 *  fallthrough string for forward-compat. */
export type AnalysisStatus = 'none' | 'running' | 'completed' | 'failed' | (string & {});

export interface StartAnalysisReq {
  type: AnalysisType;
  invalidateCache?: boolean;
}
export interface StartAnalysisResp {
  analysisId: string;
  status: 'running';
}
export interface StartAnalysisErrorResp { error: string }

export interface FileScoreNote {
  overview: string;
  lines: { line: number; content: string }[];
}

export interface FileScore {
  reviewFileId: string;
  filePath: string;
  sortOrder: number;
  aggregateScore: number | null;
  rationale: string | null;
  dimensionScores: Record<string, number> | null;
  notes: FileScoreNote | null;
}

export interface GetAnalysisReq { type: AnalysisType }
export interface GetAnalysisResp {
  status: AnalysisStatus;
  error?: string | null;
  progressCompleted?: number;
  progressTotal?: number;
  scores: FileScore[];
}

export interface GetAnalysisStatusReq { type: AnalysisType }
export interface GetAnalysisStatusResp {
  status: AnalysisStatus;
  error?: string | null;
  progressCompleted?: number;
  progressTotal?: number;
}

// --- Debug ---

export interface GetAIDebugStatusResp { enabled: boolean }

export interface SendAIDebugLogReq { message: string }
export interface SendAIDebugLogResp { ok: true }

// --- Preferences ---

export interface UserPreferencesShape {
  sort_mode?: string;
  risk_sort_dimension?: string;
  show_risk_scores?: boolean;
  ignore_whitespace?: boolean;
  svg_view_mode?: string;
  last_image_mode?: string;
}
export type GetAIPreferencesResp = UserPreferencesShape;
export type SaveAIPreferencesReq = UserPreferencesShape;
export interface SaveAIPreferencesResp { ok: true }

// --- Callers ---

export async function getAIConfig(): Promise<AIConfigResp> {
  return api<AIConfigResp>('/ai/config');
}

export async function saveAIConfig(req: SaveAIConfigReq): Promise<SaveAIConfigResp> {
  return api<SaveAIConfigResp>('/ai/config', { method: 'POST', body: req });
}

export async function listAIModels(): Promise<ListAIModelsResp> {
  return api<ListAIModelsResp>('/ai/models');
}

export async function getAIKeyStatus(): Promise<GetAIKeyStatusResp> {
  return api<GetAIKeyStatusResp>('/ai/key-status');
}

export async function saveAIKey(req: SaveAIKeyReq): Promise<SaveAIKeyResp> {
  return api<SaveAIKeyResp>('/ai/key', { method: 'POST', body: req });
}

export async function deleteAIKey(req: DeleteAIKeyReq): Promise<DeleteAIKeyResp> {
  return api<DeleteAIKeyResp>(`/ai/key${qs({ platform: req.platform })}`, { method: 'DELETE' });
}

export async function startAnalysis(req: StartAnalysisReq): Promise<StartAnalysisResp | StartAnalysisErrorResp> {
  return api<StartAnalysisResp | StartAnalysisErrorResp>('/ai/analyze', { method: 'POST', body: req });
}

export async function getAnalysis(req: GetAnalysisReq): Promise<GetAnalysisResp> {
  return api<GetAnalysisResp>(`/ai/analysis/${req.type}`);
}

export async function getAnalysisStatus(req: GetAnalysisStatusReq): Promise<GetAnalysisStatusResp> {
  return api<GetAnalysisStatusResp>(`/ai/analysis/${req.type}/status`);
}

export async function getAIDebugStatus(): Promise<GetAIDebugStatusResp> {
  return api<GetAIDebugStatusResp>('/ai/debug-status');
}

export async function sendAIDebugLog(req: SendAIDebugLogReq): Promise<SendAIDebugLogResp> {
  return api<SendAIDebugLogResp>('/ai/debug-log', { method: 'POST', body: req });
}

export async function getAIPreferences(): Promise<GetAIPreferencesResp> {
  return api<GetAIPreferencesResp>('/ai/preferences');
}

export async function saveAIPreferences(req: SaveAIPreferencesReq): Promise<SaveAIPreferencesResp> {
  return api<SaveAIPreferencesResp>('/ai/preferences', { method: 'POST', body: req });
}
