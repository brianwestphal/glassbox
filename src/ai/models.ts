import { z } from 'zod';

export const AIModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  contextWindow: z.number(),
  isDefault: z.boolean(),
});
export type AIModel = z.infer<typeof AIModelSchema>;

export const AIPlatformSchema = z.enum(['anthropic', 'openai', 'google']);
export type AIPlatform = z.infer<typeof AIPlatformSchema>;

/** Runtime guard — narrows `unknown` to `AIPlatform`. */
export function isAIPlatform(value: unknown): value is AIPlatform {
  return AIPlatformSchema.safeParse(value).success;
}

export const PLATFORMS: Record<AIPlatform, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

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
};

export const ENV_KEY_NAMES: Record<AIPlatform, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
};

export function getDefaultModel(platform: AIPlatform): string {
  const models = MODELS[platform];
  const def = models.find(m => m.isDefault);
  return def ? def.id : models[0].id;
}

export function getModelContextWindow(platform: AIPlatform, modelId: string): number {
  const model = MODELS[platform].find(m => m.id === modelId);
  return model ? model.contextWindow : 128000;
}

/**
 * Coarse "family/tier" key for a model id, used for best-effort matching when a
 * stored id is no longer offered. The family is intentionally version-agnostic
 * (`claude-sonnet-4-5` and `claude-sonnet-4-20250514` both map to the sonnet
 * family) so an upgrade like sonnet 4.5 → 4.6 matches automatically.
 */
function modelFamily(id: string): string {
  const lower = id.toLowerCase();
  for (const tier of ['opus', 'sonnet', 'haiku']) {
    if (lower.includes(tier)) return `anthropic:${tier}`;
  }
  if (lower.includes('gemini')) {
    if (lower.includes('flash')) return 'google:flash';
    if (lower.includes('pro')) return 'google:pro';
    return 'google:gemini';
  }
  if (lower.includes('gpt') || lower.startsWith('o1') || lower.startsWith('o3')) {
    return lower.includes('mini') ? 'openai:mini' : 'openai:gpt';
  }
  return lower;
}

/**
 * Resolve a (possibly stale or older) model id to one currently offered for the
 * platform. Exact match wins; otherwise best-effort match by family — e.g. a
 * retired `claude-sonnet-4-20250514` or an older `claude-sonnet-4-5` resolves to
 * the current `claude-sonnet-4-6` — and as a last resort the platform default.
 * This keeps a saved preference pointing at a now-retired snapshot from 404ing
 * (GB-893); the model lists themselves still need to be kept current.
 */
export function resolveModelId(platform: AIPlatform, modelId: string): string {
  const models = MODELS[platform];
  if (models.some(m => m.id === modelId)) return modelId;
  const family = modelFamily(modelId);
  const familyMatch = models.find(m => modelFamily(m.id) === family);
  return familyMatch ? familyMatch.id : getDefaultModel(platform);
}
