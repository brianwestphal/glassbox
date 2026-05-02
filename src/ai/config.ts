import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH, readGlobalConfig, updateGlobalConfig } from '../global-config.js';
import { resolveAPIKey as _resolveAPIKey } from './api-keys.js';
import type { AIPlatform } from './models.js';
import { getDefaultModel } from './models.js';

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

export interface ConfigFile {
  ai?: {
    platform?: string;
    model?: string;
    keys?: Record<string, string>;
  };
  guidedReview?: {
    enabled?: boolean;
    topics?: string[];
  };
}

export function readConfigFile(): ConfigFile {
  return readGlobalConfig() as ConfigFile;
}

export function loadAIConfig(): AIConfig {
  const config = readConfigFile();
  const platform = (config.ai?.platform ?? 'anthropic') as AIPlatform;
  const model = config.ai?.model ?? getDefaultModel(platform);

  const { key, source } = _resolveAPIKey(platform);

  return { platform, model, apiKey: key, keySource: source };
}

export function saveAIConfigPreferences(platform: AIPlatform, model: string): void {
  updateGlobalConfig((config) => {
    const cfg = config as ConfigFile;
    if (cfg.ai === undefined) cfg.ai = {};
    cfg.ai.platform = platform;
    cfg.ai.model = model;
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
    (config as ConfigFile).guidedReview = { enabled: settings.enabled, topics: settings.topics };
  });
}

// Re-exports for backward compatibility — existing importers continue to work
export { deleteAPIKey, detectAvailablePlatforms, getKeychainLabel,isKeychainAvailable, resolveAPIKey, saveAPIKey } from './api-keys.js';
