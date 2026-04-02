import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

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

export const CONFIG_DIR = join(homedir(), '.glassbox');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

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
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as ConfigFile;
    }
  } catch { /* corrupt config */ }
  return {};
}

export function writeConfigFile(config: ConfigFile): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch { /* permissions may not apply on all OS */ }
}

export function loadAIConfig(): AIConfig {
  const config = readConfigFile();
  const platform = (config.ai?.platform ?? 'anthropic') as AIPlatform;
  const model = config.ai?.model ?? getDefaultModel(platform);

  const { key, source } = _resolveAPIKey(platform);

  return { platform, model, apiKey: key, keySource: source };
}

export function saveAIConfigPreferences(platform: AIPlatform, model: string): void {
  const config = readConfigFile();
  if (config.ai === undefined) config.ai = {};
  config.ai.platform = platform;
  config.ai.model = model;
  writeConfigFile(config);
}

export function loadGuidedReviewConfig(): GuidedReviewConfig {
  const config = readConfigFile();
  return {
    enabled: config.guidedReview?.enabled ?? false,
    topics: config.guidedReview?.topics ?? [],
  };
}

export function saveGuidedReviewConfig(settings: GuidedReviewConfig): void {
  const config = readConfigFile();
  config.guidedReview = { enabled: settings.enabled, topics: settings.topics };
  writeConfigFile(config);
}

// Re-exports for backward compatibility — existing importers continue to work
export { resolveAPIKey, saveAPIKey, deleteAPIKey, detectAvailablePlatforms, isKeychainAvailable, getKeychainLabel } from './api-keys.js';
