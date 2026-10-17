import { z } from 'zod';

export const AIModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  contextWindow: z.number(),
  isDefault: z.boolean(),
});
export type AIModel = z.infer<typeof AIModelSchema>;

export const AIPlatformSchema = z.enum(['anthropic', 'openai', 'google', 'local', 'apple']);
export type AIPlatform = z.infer<typeof AIPlatformSchema>;

/** Platforms that run without an API key (local servers / on-device). */
export const KEYLESS_PLATFORMS: ReadonlySet<AIPlatform> = new Set<AIPlatform>(['local', 'apple']);

/** Runtime guard — narrows `unknown` to `AIPlatform`. */
export function isAIPlatform(value: unknown): value is AIPlatform {
  return AIPlatformSchema.safeParse(value).success;
}

export const PLATFORMS: Record<AIPlatform, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  local: 'Local',
  apple: 'Apple',
};

/** The single on-device Apple Foundation Models entry. There is no model-id
 *  vocabulary to discover (it's the system model reached via the Swift
 *  `FoundationModels` API), so this fixed id stands in for it. */
export const APPLE_ON_DEVICE_MODEL_ID = 'apple-on-device';

/**
 * Kill-switch for Apple Foundation Models as a code-analysis platform. When
 * `false`, the platform is hidden from the picker and a saved `apple` preference
 * falls back to the cloud default (see `loadAIConfig`).
 *
 * It's enabled. The on-device model's 4096-token window — shared by input *and*
 * output — can't fit the risk-analysis prompt + verbose JSON output for larger
 * diffs (it overflows with `exceededContextWindowSize`, and that ceiling isn't
 * removable by prompt trimming since the model must see the whole file). So
 * rather than gate the platform off, selecting `apple` lets the user choose a
 * **secondary non-Apple fallback model**: each analysis batch runs on-device,
 * and any batch that fails spills to the fallback (`AIConfig.fallback`, resolved
 * in `loadAIConfig`; applied per-batch in `runAnalysisBatch`). Flip to `false`
 * to disable the platform entirely again.
 */
// Typed as `boolean` (not the inferred literal `true`) so the gate checks aren't
// flagged as constant conditions and toggling it stays a one-line edit.
export const APPLE_FM_ANALYSIS_ENABLED: boolean = true;

// Keep this list up to date — check at least once a day when working on the project
export const MODELS: Record<AIPlatform, AIModel[]> = {
  anthropic: [
    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', contextWindow: 1000000, isDefault: false },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 1000000, isDefault: true },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000, isDefault: false },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, isDefault: true },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, isDefault: false },
  ],
  google: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1000000, isDefault: true },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1000000, isDefault: false },
  ],
  // Local models are server-specific and discovered live from the configured
  // endpoint; this is only the fallback default when discovery is unavailable.
  local: [
    { id: 'llama3.1', name: 'Llama 3.1', contextWindow: 8192, isDefault: true },
  ],
  // On-device Apple Foundation Models — a single fixed entry (no discovery).
  // The on-device model has a small context window, so batch conservatively.
  apple: [
    { id: APPLE_ON_DEVICE_MODEL_ID, name: 'Apple On-Device', contextWindow: 4096, isDefault: true },
  ],
};

export const ENV_KEY_NAMES: Record<AIPlatform, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  // Optional — most local servers (Ollama) need no key; some do.
  local: 'GLASSBOX_LOCAL_API_KEY',
  // Apple Foundation Models are keyless (on-device). This name is never read
  // for auth — `apple` is in KEYLESS_PLATFORMS — but the record requires an
  // entry per platform.
  apple: 'GLASSBOX_APPLE_API_KEY',
};

export function getDefaultModel(platform: AIPlatform): string {
  const models = MODELS[platform];
  const def = models.find(m => m.isDefault);
  return def ? def.id : models[0].id;
}

export function getModelContextWindow(platform: AIPlatform, modelId: string): number {
  const model = MODELS[platform].find(m => m.id === modelId);
  if (model) return model.contextWindow;
  // Unknown model: local/on-device models have small windows, so batch
  // conservatively; cloud models default higher.
  if (platform === 'local') return 8192;
  if (platform === 'apple') return 4096;
  return 128000;
}

// Only migrate specific legacy selections. The fallback catalog cannot tell us
// whether an unfamiliar provider-discovered model is unavailable or simply new.
const LEGACY_MODEL_IDS: Partial<Record<AIPlatform, Record<string, string>>> = {
  anthropic: {
    'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
    'claude-sonnet-4-5': 'claude-sonnet-4-6',
    'claude-opus-4-1': 'claude-opus-4-8',
    'claude-haiku-4-20250514': 'claude-haiku-4-5',
  },
  google: {
    'gemini-1.5-pro': 'gemini-2.5-pro',
    'gemini-1.5-flash': 'gemini-2.5-flash',
  },
};

/** Preserve provider model IDs; default only when no model was selected. */
export function resolveModelId(platform: AIPlatform, modelId: string): string {
  if (modelId.trim() === '') return getDefaultModel(platform);
  const migrations = LEGACY_MODEL_IDS[platform];
  return migrations && Object.hasOwn(migrations, modelId) ? migrations[modelId] : modelId;
}
