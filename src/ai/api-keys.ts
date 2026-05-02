import { spawnSync } from 'child_process';

import { updateGlobalConfig } from '../global-config.js';
import type { ConfigFile } from './config.js';
import { readConfigFile } from './config.js';
import { getKeyFromKeychain, saveKeyToKeychain, winCredTarget } from './keychain.js';
import type { AIPlatform } from './models.js';
import { ENV_KEY_NAMES } from './models.js';

export { getKeychainLabel, isKeychainAvailable } from './keychain.js';

export function getKeyFromEnv(platform: AIPlatform): string | null {
  const envName = ENV_KEY_NAMES[platform];
  return process.env[envName] ?? null;
}

export function getKeyFromConfig(platform: AIPlatform): string | null {
  const config = readConfigFile();
  const encoded = config.ai?.keys?.[platform];
  if (encoded === undefined || encoded === '') return null;
  try {
    return Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

export function resolveAPIKey(platform: AIPlatform): { key: string | null; source: 'env' | 'keychain' | 'config' | null } {
  // Priority: env > keychain > config file
  const envKey = getKeyFromEnv(platform);
  if (envKey !== null) return { key: envKey, source: 'env' };

  const keychainKey = getKeyFromKeychain(platform);
  if (keychainKey !== null) return { key: keychainKey, source: 'keychain' };

  const configKey = getKeyFromConfig(platform);
  if (configKey !== null) return { key: configKey, source: 'config' };

  return { key: null, source: null };
}

export function saveAPIKey(platform: AIPlatform, key: string, storage: 'keychain' | 'config'): void {
  if (storage === 'keychain') {
    saveKeyToKeychain(platform, key);
  } else {
    updateGlobalConfig((raw) => {
      const cfg = raw as ConfigFile;
      if (cfg.ai === undefined) cfg.ai = {};
      if (cfg.ai.keys === undefined) cfg.ai.keys = {};
      cfg.ai.keys[platform] = Buffer.from(key).toString('base64');
    });
  }
}

export function deleteAPIKey(platform: AIPlatform): void {
  const os = process.platform;
  const account = `${platform}-api-key`;

  // Remove from system keychain
  try {
    if (os === 'darwin') {
      spawnSync('security', ['delete-generic-password', '-s', 'glassbox', '-a', account], { stdio: 'pipe' });
    } else if (os === 'linux') {
      spawnSync('secret-tool', ['clear', 'service', 'glassbox', 'account', account], { stdio: 'pipe' });
    } else if (os === 'win32') {
      const target = winCredTarget(platform);
      spawnSync('powershell', ['-NoProfile', '-Command', '-'], { input: `cmdkey /delete:'${target}'`, encoding: 'utf-8' });
    }
  } catch { /* may not exist */ }

  // Remove from config file (only if there is something to clear)
  if (readConfigFile().ai?.keys === undefined) return;
  updateGlobalConfig((raw) => {
    const cfg = raw as ConfigFile;
    if (cfg.ai?.keys !== undefined) {
      cfg.ai.keys[platform] = '';
    }
  });
}

export function detectAvailablePlatforms(): { platform: AIPlatform; source: 'env' | 'keychain' | 'config' }[] {
  const results: { platform: AIPlatform; source: 'env' | 'keychain' | 'config' }[] = [];
  for (const platform of ['anthropic', 'openai', 'google'] as AIPlatform[]) {
    const { source } = resolveAPIKey(platform);
    if (source !== null) {
      results.push({ platform, source });
    }
  }
  return results;
}
