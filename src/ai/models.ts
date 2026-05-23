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
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000, isDefault: true },
    { id: 'claude-haiku-4-20250514', name: 'Claude Haiku 4', contextWindow: 200000, isDefault: false },
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
