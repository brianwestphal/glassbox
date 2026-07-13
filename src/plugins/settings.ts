/**
 * Per-plugin preference storage (doc 29 FR-29.12, GB-1047). A plugin declares
 * `preferences` in its manifest and reads them via `PluginContext.getSetting`;
 * the Settings → Plugins tab renders + writes them. Non-secret values persist in
 * the global config (`~/.glassbox/config.json`) or the project settings
 * (`.glassbox/settings.json`) per the preference's `scope` (default global).
 *
 * Keychain-backed **secret** preferences are a follow-up (GB-1054); a `secret`
 * pref is currently stored like a normal one, so plugins should not yet use it
 * for real secrets.
 */
import { readGlobalConfig, updateGlobalConfig } from '../global-config.js';
import { readProjectSettings, updateProjectSettings } from '../project-settings-store.js';
import type { PluginManifest, PluginPreference } from './manifest.js';

type SettingsMap = Record<string, Record<string, string>>;

function coerceSettingsMap(raw: unknown): SettingsMap {
  const out: SettingsMap = {};
  if (raw === null || typeof raw !== 'object') return out;
  for (const [pluginId, byKey] of Object.entries(raw as Record<string, unknown>)) {
    if (byKey === null || typeof byKey !== 'object') continue;
    const entry: Record<string, string> = {};
    for (const [k, v] of Object.entries(byKey as Record<string, unknown>)) {
      if (typeof v === 'string') entry[k] = v;
    }
    out[pluginId] = entry;
  }
  return out;
}

function prefFor(manifest: PluginManifest, key: string): PluginPreference | undefined {
  return manifest.preferences?.find((p) => p.key === key);
}

function scopeOf(pref: PluginPreference | undefined): 'global' | 'project' {
  return pref?.scope === 'project' ? 'project' : 'global';
}

function readGlobalSettings(): SettingsMap {
  return coerceSettingsMap(readGlobalConfig().pluginSettings);
}
function readProjectSettingsMap(repoRoot: string): SettingsMap {
  return coerceSettingsMap(readProjectSettings(repoRoot).pluginSettings);
}

/** A plugin's stored value, or undefined (a missing plugin id / key). The cast
 *  reflects that a `Record` index can be absent at runtime. */
function lookup(map: SettingsMap, pluginId: string, key: string): string | undefined {
  return (map[pluginId] as Record<string, string> | undefined)?.[key];
}

/** Read a plugin setting; falls back to the manifest-declared default, else null. */
export function readPluginSetting(manifest: PluginManifest, repoRoot: string, key: string): string | null {
  const pref = prefFor(manifest, key);
  const map = scopeOf(pref) === 'project' ? readProjectSettingsMap(repoRoot) : readGlobalSettings();
  const stored = lookup(map, manifest.id, key);
  if (stored !== undefined) return stored;
  return pref?.default ?? null;
}

/** Persist a plugin setting to the scope declared by its preference (default global). */
export function writePluginSetting(manifest: PluginManifest, repoRoot: string, key: string, value: string): void {
  if (scopeOf(prefFor(manifest, key)) === 'project') {
    updateProjectSettings(repoRoot, (s) => {
      const map = coerceSettingsMap(s.pluginSettings);
      map[manifest.id] = { ...(map[manifest.id] as Record<string, string> | undefined), [key]: value };
      s.pluginSettings = map;
    });
  } else {
    updateGlobalConfig((cfg) => {
      const map = coerceSettingsMap(cfg.pluginSettings);
      map[manifest.id] = { ...(map[manifest.id] as Record<string, string> | undefined), [key]: value };
      return { ...cfg, pluginSettings: map };
    });
  }
}

/** Every declared preference's current value, for the management UI. */
export function readPluginPreferenceValues(manifest: PluginManifest, repoRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of manifest.preferences ?? []) {
    out[p.key] = readPluginSetting(manifest, repoRoot, p.key) ?? '';
  }
  return out;
}
