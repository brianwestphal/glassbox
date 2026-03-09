import { execSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { AIPlatform } from './models.js';
import { ENV_KEY_NAMES, getDefaultModel } from './models.js';

export interface AIConfig {
  platform: AIPlatform;
  model: string;
  apiKey: string | null;
  keySource: 'env' | 'keychain' | 'config' | null;
}

const CONFIG_DIR = join(homedir(), '.glassbox');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

interface ConfigFile {
  ai?: {
    platform?: string;
    model?: string;
    keys?: Record<string, string>;
  };
}

function readConfigFile(): ConfigFile {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as ConfigFile;
    }
  } catch { /* corrupt config */ }
  return {};
}

function writeConfigFile(config: ConfigFile): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch { /* permissions may not apply on all OS */ }
}

function getKeyFromEnv(platform: AIPlatform): string | null {
  const envName = ENV_KEY_NAMES[platform];
  return process.env[envName] ?? null;
}

// PowerShell script that uses P/Invoke to read from Windows Credential Manager.
// cmdkey can store/delete but cannot retrieve passwords, so we use CredRead directly.
const WIN_CRED_READ_PS = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CredHelper {
    [DllImport("advapi32", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CredRead(string t, int type, int f, out IntPtr p);
    [DllImport("advapi32")]
    static extern void CredFree(IntPtr p);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CRED {
        public int Flags; public int Type; public string TargetName; public string Comment;
        public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
        public int Persist; public int AttributeCount; public IntPtr Attributes;
        public string TargetAlias; public string UserName;
    }
    public static string Read(string target) {
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr)) return "";
        CRED c = (CRED)Marshal.PtrToStructure(ptr, typeof(CRED));
        string r = Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
        CredFree(ptr);
        return r;
    }
}
'@
`;

function winCredTarget(platform: AIPlatform): string {
  return `glassbox-${platform}-api-key`;
}

function getKeyFromKeychain(platform: AIPlatform): string | null {
  const os = process.platform;
  const account = `${platform}-api-key`;

  try {
    if (os === 'darwin') {
      const result = execSync(
        `security find-generic-password -s glassbox -a "${account}" -w 2>/dev/null`,
        { encoding: 'utf-8' }
      ).trim();
      return result !== '' ? result : null;
    }

    if (os === 'linux') {
      const result = execSync(
        `secret-tool lookup service glassbox account "${account}" 2>/dev/null`,
        { encoding: 'utf-8' }
      ).trim();
      return result !== '' ? result : null;
    }

    if (os === 'win32') {
      const target = winCredTarget(platform);
      const script = WIN_CRED_READ_PS + `Write-Output ([CredHelper]::Read('${target}'))`;
      const result = execSync('powershell -NoProfile -Command -', {
        input: script,
        encoding: 'utf-8',
      }).trim();
      return result !== '' ? result : null;
    }
  } catch {
    return null;
  }

  return null;
}

function getKeyFromConfig(platform: AIPlatform): string | null {
  const config = readConfigFile();
  const encoded = config.ai?.keys?.[platform];
  if (encoded === undefined || encoded === '') return null;
  try {
    return Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

export function resolveAPIKey(platform: AIPlatform): { key: string | null; source: AIConfig['keySource'] } {
  // Priority: env > keychain > config file
  const envKey = getKeyFromEnv(platform);
  if (envKey !== null) return { key: envKey, source: 'env' };

  const keychainKey = getKeyFromKeychain(platform);
  if (keychainKey !== null) return { key: keychainKey, source: 'keychain' };

  const configKey = getKeyFromConfig(platform);
  if (configKey !== null) return { key: configKey, source: 'config' };

  return { key: null, source: null };
}

export function loadAIConfig(): AIConfig {
  const config = readConfigFile();
  const platform = (config.ai?.platform ?? 'anthropic') as AIPlatform;
  const model = config.ai?.model ?? getDefaultModel(platform);
  const { key, source } = resolveAPIKey(platform);

  return { platform, model, apiKey: key, keySource: source };
}

export function saveAIConfigPreferences(platform: AIPlatform, model: string): void {
  const config = readConfigFile();
  if (config.ai === undefined) config.ai = {};
  config.ai.platform = platform;
  config.ai.model = model;
  writeConfigFile(config);
}

export function saveAPIKey(platform: AIPlatform, key: string, storage: 'keychain' | 'config'): void {
  if (storage === 'keychain') {
    saveKeyToKeychain(platform, key);
  } else {
    const config = readConfigFile();
    if (config.ai === undefined) config.ai = {};
    if (config.ai.keys === undefined) config.ai.keys = {};
    config.ai.keys[platform] = Buffer.from(key).toString('base64');
    writeConfigFile(config);
  }
}

function saveKeyToKeychain(platform: AIPlatform, key: string): void {
  const os = process.platform;
  const account = `${platform}-api-key`;

  if (os === 'darwin') {
    try {
      execSync(`security delete-generic-password -s glassbox -a "${account}" 2>/dev/null`);
    } catch { /* may not exist */ }
    execSync(
      `security add-generic-password -s glassbox -a "${account}" -w "${key.replace(/"/g, '\\"')}"`,
    );
    return;
  }

  if (os === 'linux') {
    // secret-tool reads the password from stdin
    execSync(
      `secret-tool store --label='Glassbox API Key' service glassbox account "${account}"`,
      { input: key, encoding: 'utf-8' },
    );
    return;
  }

  if (os === 'win32') {
    const target = winCredTarget(platform);
    // Escape single quotes for PowerShell single-quoted string
    const escapedKey = key.replace(/'/g, "''");
    const script = `cmdkey /generic:'${target}' /user:'glassbox' /pass:'${escapedKey}'`;
    execSync('powershell -NoProfile -Command -', {
      input: script,
      encoding: 'utf-8',
    });
  }
}

export function deleteAPIKey(platform: AIPlatform): void {
  const os = process.platform;
  const account = `${platform}-api-key`;

  // Remove from system keychain
  try {
    if (os === 'darwin') {
      execSync(`security delete-generic-password -s glassbox -a "${account}" 2>/dev/null`);
    } else if (os === 'linux') {
      execSync(`secret-tool clear service glassbox account "${account}" 2>/dev/null`);
    } else if (os === 'win32') {
      const target = winCredTarget(platform);
      execSync('powershell -NoProfile -Command -', {
        input: `cmdkey /delete:'${target}'`,
        encoding: 'utf-8',
      });
    }
  } catch { /* may not exist */ }

  // Remove from config file
  const config = readConfigFile();
  if (config.ai?.keys !== undefined) {
    config.ai.keys[platform] = '';
    writeConfigFile(config);
  }
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

export function isKeychainAvailable(): boolean {
  const os = process.platform;
  if (os === 'darwin' || os === 'win32') return true;
  if (os === 'linux') {
    try {
      execSync('which secret-tool 2>/dev/null', { encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function getKeychainLabel(): string {
  const os = process.platform;
  if (os === 'darwin') return 'Keychain';
  if (os === 'linux') return 'System Keyring';
  if (os === 'win32') return 'Credential Manager';
  return 'System Keychain';
}
