/**
 * Typed API for the AI subsystem — config, key management, analysis
 * runs, and per-user preferences. The server routes mount these under
 * `/api/ai/*`.
 */
import { z } from 'zod';

import { AIModelSchema, AIPlatformSchema } from '../ai/models.js';
import { apiCall, OkResponseSchema, qs } from './_runner.js';

export { AIModelSchema, AIPlatformSchema };
export type { AIModel, AIPlatform } from '../ai/models.js';

// --- Config ---

export const KeySourceSchema = z.enum(['env', 'keychain', 'config']).nullable();
export type KeySource = z.infer<typeof KeySourceSchema>;

export const KeyStorageSchema = z.enum(['keychain', 'config']);
export type KeyStorage = z.infer<typeof KeyStorageSchema>;

export const GuidedReviewConfigShapeSchema = z.object({
  enabled: z.boolean(),
  topics: z.array(z.string()),
});
export type GuidedReviewConfigShape = z.infer<typeof GuidedReviewConfigShapeSchema>;

export const AIConfigRespSchema = z.object({
  platform: AIPlatformSchema,
  model: z.string(),
  keyConfigured: z.boolean(),
  keySource: KeySourceSchema,
  guidedReview: GuidedReviewConfigShapeSchema,
});
export type AIConfigResp = z.infer<typeof AIConfigRespSchema>;

export const SaveAIConfigReqSchema = z.object({
  platform: AIPlatformSchema,
  model: z.string().min(1),
  guidedReview: GuidedReviewConfigShapeSchema.optional(),
});
export type SaveAIConfigReq = z.infer<typeof SaveAIConfigReqSchema>;

export const SaveAIConfigRespSchema = OkResponseSchema;
export type SaveAIConfigResp = z.infer<typeof SaveAIConfigRespSchema>;

export const ListAIModelsRespSchema = z.object({
  platforms: z.record(AIPlatformSchema, z.string()),
  models: z.record(AIPlatformSchema, z.array(AIModelSchema)),
});
export type ListAIModelsResp = z.infer<typeof ListAIModelsRespSchema>;

export const AIKeyStatusEntrySchema = z.object({
  configured: z.boolean(),
  source: KeySourceSchema,
});
export type AIKeyStatusEntry = z.infer<typeof AIKeyStatusEntrySchema>;

export const AvailablePlatformEntrySchema = z.object({
  platform: AIPlatformSchema,
  source: z.enum(['env', 'keychain', 'config']),
});
export type AvailablePlatformEntry = z.infer<typeof AvailablePlatformEntrySchema>;

export const GetAIKeyStatusRespSchema = z.object({
  status: z.record(AIPlatformSchema, AIKeyStatusEntrySchema),
  keychainAvailable: z.boolean(),
  keychainLabel: z.string(),
  availablePlatforms: z.array(AvailablePlatformEntrySchema),
});
export type GetAIKeyStatusResp = z.infer<typeof GetAIKeyStatusRespSchema>;

export const SaveAIKeyReqSchema = z.object({
  platform: AIPlatformSchema,
  key: z.string().min(1),
  storage: KeyStorageSchema,
});
export type SaveAIKeyReq = z.infer<typeof SaveAIKeyReqSchema>;
export const SaveAIKeyRespSchema = OkResponseSchema;
export type SaveAIKeyResp = z.infer<typeof SaveAIKeyRespSchema>;

export const DeleteAIKeyReqSchema = z.object({ platform: AIPlatformSchema });
export type DeleteAIKeyReq = z.infer<typeof DeleteAIKeyReqSchema>;
export const DeleteAIKeyRespSchema = OkResponseSchema;
export type DeleteAIKeyResp = z.infer<typeof DeleteAIKeyRespSchema>;

// --- Analysis ---

export const AnalysisTypeSchema = z.enum(['risk', 'narrative', 'guided']);
export type AnalysisType = z.infer<typeof AnalysisTypeSchema>;

/** Server-side analysis row status — narrow to known values but allow a
 *  fallthrough string for forward-compat. */
export const AnalysisStatusSchema = z.string();
export type AnalysisStatus = 'none' | 'running' | 'completed' | 'failed' | (string & {});

export const StartAnalysisReqSchema = z.object({
  type: AnalysisTypeSchema,
  invalidateCache: z.boolean().optional(),
});
export type StartAnalysisReq = z.infer<typeof StartAnalysisReqSchema>;

export const StartAnalysisRespSchema = z.object({
  analysisId: z.string(),
  status: z.literal('running'),
});
export type StartAnalysisResp = z.infer<typeof StartAnalysisRespSchema>;

export const StartAnalysisErrorRespSchema = z.object({ error: z.string() });
export type StartAnalysisErrorResp = z.infer<typeof StartAnalysisErrorRespSchema>;

export const FileScoreNoteSchema = z.object({
  overview: z.string(),
  lines: z.array(z.object({ line: z.number(), content: z.string() })),
});
export type FileScoreNote = z.infer<typeof FileScoreNoteSchema>;

// The score entry — every field except the identifying ones may be
// missing from the wire (server omits fields it didn't compute) and may
// be `null` for historical rows. `.nullable().default(null)` collapses
// both cases to `null` so downstream `s.notes !== null` checks behave
// the same way regardless of which form the server used.
export const FileScoreSchema = z.object({
  reviewFileId: z.string(),
  filePath: z.string(),
  sortOrder: z.number(),
  aggregateScore: z.number().nullable().default(null),
  rationale: z.string().nullable().default(null),
  dimensionScores: z.record(z.string(), z.number()).nullable().default(null),
  notes: FileScoreNoteSchema.nullable().default(null),
});
export type FileScore = z.infer<typeof FileScoreSchema>;

export const GetAnalysisReqSchema = z.object({ type: AnalysisTypeSchema });
export type GetAnalysisReq = z.infer<typeof GetAnalysisReqSchema>;

export const GetAnalysisRespSchema = z.object({
  status: AnalysisStatusSchema,
  error: z.string().nullable().optional(),
  progressCompleted: z.number().optional(),
  progressTotal: z.number().optional(),
  scores: z.array(FileScoreSchema),
});
export type GetAnalysisResp = z.infer<typeof GetAnalysisRespSchema>;

export const GetAnalysisStatusReqSchema = z.object({ type: AnalysisTypeSchema });
export type GetAnalysisStatusReq = z.infer<typeof GetAnalysisStatusReqSchema>;

export const GetAnalysisStatusRespSchema = z.object({
  status: AnalysisStatusSchema,
  error: z.string().nullable().optional(),
  progressCompleted: z.number().optional(),
  progressTotal: z.number().optional(),
});
export type GetAnalysisStatusResp = z.infer<typeof GetAnalysisStatusRespSchema>;

// --- Debug ---

export const GetAIDebugStatusRespSchema = z.object({ enabled: z.boolean() });
export type GetAIDebugStatusResp = z.infer<typeof GetAIDebugStatusRespSchema>;

export const SendAIDebugLogReqSchema = z.object({ message: z.string() });
export type SendAIDebugLogReq = z.infer<typeof SendAIDebugLogReqSchema>;
export const SendAIDebugLogRespSchema = OkResponseSchema;
export type SendAIDebugLogResp = z.infer<typeof SendAIDebugLogRespSchema>;

// --- Preferences ---

export const SortModeSchema = z.enum(['folder', 'risk', 'narrative', 'guided']);
export type SortMode = z.infer<typeof SortModeSchema>;

export const RiskDimensionSchema = z.enum([
  'aggregate', 'security', 'correctness', 'error-handling', 'maintainability', 'architecture', 'performance',
]);
export type RiskDimension = z.infer<typeof RiskDimensionSchema>;

export const SvgViewModeSchema = z.enum(['code', 'rendered']);
export type SvgViewMode = z.infer<typeof SvgViewModeSchema>;

export const ImageModeSchema = z.enum(['metadata', 'side-by-side', 'difference', 'slice']);
export type ImageMode = z.infer<typeof ImageModeSchema>;

// GB-844: scope filter — applied as a CSS class on `#diff-container` to hide
// non-matching `.diff-line` rows. Default is `all` (no filter).
export const ScopeFilterSchema = z.enum(['all', 'adds', 'removes', 'changed']);
export type ScopeFilter = z.infer<typeof ScopeFilterSchema>;

/**
 * Stored preferences shape. The GET response uses `z.string()` (not the
 * enum schemas) for fields the DB persists as plain strings, so a row
 * written by an older version of Glassbox still parses cleanly. The
 * SAVE request, however, validates against the enums — that's the
 * sharp end where invalid input should be rejected.
 */
export const UserPreferencesShapeSchema = z.object({
  sort_mode: z.string().optional(),
  risk_sort_dimension: z.string().optional(),
  show_risk_scores: z.boolean().optional(),
  ignore_whitespace: z.boolean().optional(),
  svg_view_mode: z.string().optional(),
  last_image_mode: z.string().optional(),
  scope_filter: z.string().optional(),
});
export type UserPreferencesShape = z.infer<typeof UserPreferencesShapeSchema>;

export const GetAIPreferencesRespSchema = UserPreferencesShapeSchema;
export type GetAIPreferencesResp = z.infer<typeof GetAIPreferencesRespSchema>;

export const SaveAIPreferencesReqSchema = z.object({
  sort_mode: SortModeSchema.optional(),
  risk_sort_dimension: RiskDimensionSchema.optional(),
  show_risk_scores: z.boolean().optional(),
  ignore_whitespace: z.boolean().optional(),
  svg_view_mode: SvgViewModeSchema.optional(),
  last_image_mode: ImageModeSchema.optional(),
  scope_filter: ScopeFilterSchema.optional(),
});
export type SaveAIPreferencesReq = z.infer<typeof SaveAIPreferencesReqSchema>;

export const SaveAIPreferencesRespSchema = OkResponseSchema;
export type SaveAIPreferencesResp = z.infer<typeof SaveAIPreferencesRespSchema>;

// --- Callers ---

export async function getAIConfig(): Promise<AIConfigResp> {
  return apiCall(AIConfigRespSchema, '/ai/config');
}

export async function saveAIConfig(req: SaveAIConfigReq): Promise<SaveAIConfigResp> {
  return apiCall(SaveAIConfigRespSchema, '/ai/config', { method: 'POST', body: req });
}

export async function listAIModels(): Promise<ListAIModelsResp> {
  return apiCall(ListAIModelsRespSchema, '/ai/models');
}

export async function getAIKeyStatus(): Promise<GetAIKeyStatusResp> {
  return apiCall(GetAIKeyStatusRespSchema, '/ai/key-status');
}

export async function saveAIKey(req: SaveAIKeyReq): Promise<SaveAIKeyResp> {
  return apiCall(SaveAIKeyRespSchema, '/ai/key', { method: 'POST', body: req });
}

export async function deleteAIKey(req: DeleteAIKeyReq): Promise<DeleteAIKeyResp> {
  return apiCall(DeleteAIKeyRespSchema, `/ai/key${qs({ platform: req.platform })}`, { method: 'DELETE' });
}

const StartAnalysisRespOrErrorSchema = z.union([StartAnalysisRespSchema, StartAnalysisErrorRespSchema]);

export async function startAnalysis(req: StartAnalysisReq): Promise<StartAnalysisResp | StartAnalysisErrorResp> {
  return apiCall(StartAnalysisRespOrErrorSchema, '/ai/analyze', { method: 'POST', body: req });
}

export async function getAnalysis(req: GetAnalysisReq): Promise<GetAnalysisResp> {
  return apiCall(GetAnalysisRespSchema, `/ai/analysis/${req.type}`);
}

export async function getAnalysisStatus(req: GetAnalysisStatusReq): Promise<GetAnalysisStatusResp> {
  return apiCall(GetAnalysisStatusRespSchema, `/ai/analysis/${req.type}/status`);
}

export async function getAIDebugStatus(): Promise<GetAIDebugStatusResp> {
  return apiCall(GetAIDebugStatusRespSchema, '/ai/debug-status');
}

export async function sendAIDebugLog(req: SendAIDebugLogReq): Promise<SendAIDebugLogResp> {
  return apiCall(SendAIDebugLogRespSchema, '/ai/debug-log', { method: 'POST', body: req });
}

export async function getAIPreferences(): Promise<GetAIPreferencesResp> {
  return apiCall(GetAIPreferencesRespSchema, '/ai/preferences');
}

export async function saveAIPreferences(req: SaveAIPreferencesReq): Promise<SaveAIPreferencesResp> {
  return apiCall(SaveAIPreferencesRespSchema, '/ai/preferences', { method: 'POST', body: req });
}
