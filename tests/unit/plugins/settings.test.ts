import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory OS keychain so secret prefs are testable without touching the real
// keychain (GB-1054). `vi.hoisted` makes `kc` available to the hoisted factory.
const { kc } = vi.hoisted(() => ({ kc: new Map<string, string>() }));
vi.mock('../../../src/ai/keychain.js', () => ({
  getSecretFromKeychain: (account: string) => kc.get(account) ?? null,
  saveSecretToKeychain: (account: string, value: string) => { kc.set(account, value); },
  deleteSecretFromKeychain: (account: string) => { kc.delete(account); },
}));

import type { PluginManifest } from '../../../src/plugins/manifest.js';
import { parseManifest } from '../../../src/plugins/manifest.js';
import { readPluginPreferenceDisplay, readPluginPreferenceValues, readPluginSetting, writePluginSetting } from '../../../src/plugins/settings.js';

const manifest: PluginManifest = parseManifest({
  id: 'settings-test-plugin',
  name: 'Settings Test',
  version: '1.0.0',
  preferences: [
    { key: 'engine', label: 'Engine', type: 'select', default: 'dot', options: ['dot', 'neato'] },
    { key: 'theme', label: 'Theme', type: 'string', scope: 'project' },
    { key: 'token', label: 'API token', type: 'string', secret: true },
  ],
}) as PluginManifest;

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'gb-prefrepo-')); kc.clear(); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe('manifest preferences (doc 29 FR-29.12)', () => {
  it('parses a preferences array', () => {
    expect(manifest.preferences).toHaveLength(3);
    expect(manifest.preferences?.[0]).toMatchObject({ key: 'engine', type: 'select', default: 'dot' });
    expect(manifest.preferences?.[1]).toMatchObject({ key: 'theme', scope: 'project' });
    expect(manifest.preferences?.[2]).toMatchObject({ key: 'token', secret: true });
  });
});

describe('plugin settings store (doc 29 FR-29.12)', () => {
  it('falls back to the declared default when unset', () => {
    // A global-scope pref with no stored value resolves to its default (read-only).
    expect(readPluginSetting(manifest, repo, 'engine')).toBe('dot');
    // No default + unset -> null.
    expect(readPluginSetting(manifest, repo, 'theme')).toBeNull();
  });

  it('round-trips a project-scoped preference through .glassbox/settings.json', () => {
    writePluginSetting(manifest, repo, 'theme', 'dark');
    expect(readPluginSetting(manifest, repo, 'theme')).toBe('dark');
    const saved = JSON.parse(readFileSync(join(repo, '.glassbox', 'settings.json'), 'utf8'));
    expect(saved.pluginSettings['settings-test-plugin'].theme).toBe('dark');
  });

  it('readPluginPreferenceValues returns every declared pref (stored or default)', () => {
    writePluginSetting(manifest, repo, 'theme', 'light');
    const values = readPluginPreferenceValues(manifest, repo);
    expect(values.engine).toBe('dot'); // default
    expect(values.theme).toBe('light'); // stored (project)
  });
});

describe('secret preferences (doc 29 FR-29.12, GB-1054)', () => {
  it('stores a secret in the keychain, not in config/project settings', () => {
    writePluginSetting(manifest, repo, 'token', 's3cr3t');
    // Lands in the (mocked) keychain under plugin-<id>-<key>.
    expect(kc.get('plugin-settings-test-plugin-token')).toBe('s3cr3t');
    // Not written to the project settings file.
    expect(() => readFileSync(join(repo, '.glassbox', 'settings.json'), 'utf8')).toThrow();
    // getSetting (plugin-facing) reads it back from the keychain.
    expect(readPluginSetting(manifest, repo, 'token')).toBe('s3cr3t');
  });

  it('never exposes the secret value in the display reader — only `configured`', () => {
    writePluginSetting(manifest, repo, 'token', 's3cr3t');
    const display = readPluginPreferenceDisplay(manifest, repo);
    expect(display.values.token).toBe(''); // masked
    expect(display.secretConfigured).toContain('token');
  });

  it('clears the secret when set to empty', () => {
    writePluginSetting(manifest, repo, 'token', 's3cr3t');
    writePluginSetting(manifest, repo, 'token', '');
    expect(kc.has('plugin-settings-test-plugin-token')).toBe(false);
    expect(readPluginPreferenceDisplay(manifest, repo).secretConfigured).not.toContain('token');
  });
});
