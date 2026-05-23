import { z } from 'zod';

import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH, readGlobalConfig, updateGlobalConfig } from '../global-config.js';
import { resolveAPIKey as _resolveAPIKey } from './api-keys.js';
import type { AIPlatform } from './models.js';
import { AIPlatformSchema, getDefaultModel } from './models.js';

export interface AIConfig {
  platform: AIPlatform;
  model: string;
  apiKey: string | null;
  keySource: 'env' | 'keychain' | 'config' | null;
}

export interface GuidedReviewConfig {
  enabled: boolean;
  topics: string[];
}

export const CONFIG_DIR = GLOBAL_CONFIG_DIR;
export const CONFIG_PATH = GLOBAL_CONFIG_PATH;

/**
 * On-disk shape of `~/.glassbox/config.json` (the slice this module
 * cares about — other modules layer their own keys onto the same
 * object). Validated at read time so a corrupt or human-edited file
 * cannot silently produce a misshapen `ConfigFile`.
 */
export const ConfigFileSchema = z.object({
  ai: z.object({
    platform: z.string().optional(),
    model: z.string().optional(),
    keys: z.record(z.string(), z.string()).optional(),
  }).optional(),
  guidedReview: z.object({
    enabled: z.boolean().optional(),
    topics: z.array(z.string()).optional(),
  }).optional(),
}).loose();
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

export function readConfigFile(): ConfigFile {
  const raw = readGlobalConfig();
  const parsed = ConfigFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export function loadAIConfig(): AIConfig {
  const config = readConfigFile();
  const platformRaw = config.ai?.platform ?? 'anthropic';
  const platform = AIPlatformSchema.safeParse(platformRaw).success
    ? AIPlatformSchema.parse(platformRaw)
    : 'anthropic';
  const model = config.ai?.model ?? getDefaultModel(platform);

  const { key, source } = _resolveAPIKey(platform);

  return { platform, model, apiKey: key, keySource: source };
}

export function saveAIConfigPreferences(platform: AIPlatform, model: string): void {
  updateGlobalConfig((config) => {
    const parsed = ConfigFileSchema.safeParse(config);
    const cfg: ConfigFile = parsed.success ? parsed.data : {};
    cfg.ai ??= {};
    cfg.ai.platform = platform;
    cfg.ai.model = model;
    return cfg;
  });
}

export function loadGuidedReviewConfig(): GuidedReviewConfig {
  const config = readConfigFile();
  return {
    enabled: config.guidedReview?.enabled ?? false,
    topics: config.guidedReview?.topics ?? [],
  };
}

export function saveGuidedReviewConfig(settings: GuidedReviewConfig): void {
  updateGlobalConfig((config) => {
    const parsed = ConfigFileSchema.safeParse(config);
    const cfg: ConfigFile = parsed.success ? parsed.data : {};
    cfg.guidedReview = { enabled: settings.enabled, topics: settings.topics };
    return cfg;
  });
}

// Re-exports for backward compatibility — existing importers continue to work
export { deleteAPIKey, detectAvailablePlatforms, getKeychainLabel,isKeychainAvailable, resolveAPIKey, saveAPIKey } from './api-keys.js';
