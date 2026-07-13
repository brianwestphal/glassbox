/**
 * Content-plugin discovery + activation (doc 29 §29.2, FR-29.3 / FR-29.6).
 *
 * Discovers plugin directories under `~/.glassbox/plugins/` (symlink-aware),
 * validates each manifest (the single trust boundary), dynamic-`import()`s the
 * plugin's single self-contained ESM entry, and calls `activate(context)`,
 * registering whatever renderers/differs it returns. Fail-soft: a plugin that
 * fails validation, has no entry, or throws on import/activation is recorded
 * with an error status and skipped — it never crashes startup or disables the
 * others.
 *
 * Modeled on Hot Sheet's `src/plugins/loader.ts`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

import { PLUGINS_ENABLED } from '../feature-flags.js';
import { GLOBAL_CONFIG_DIR } from '../global-config.js';
import { parseManifest, type PluginManifest } from './manifest.js';
import { ContentPluginRegistry } from './registry.js';
import { readPluginSetting, writePluginSetting } from './settings.js';
import type { ContentPlugin, PluginContext, PluginRegistration } from './types.js';

/** One plugin's load outcome — surfaced to the management UI (GB-1040). */
export interface LoadedPlugin {
  id: string;
  dir: string;
  manifest: PluginManifest | null;
  /** `loaded` = activated + registered; `disabled` = installed but not activated
   *  (disabled for this project / globally, doc 29 FR-29.16); `error` = failed. */
  status: 'loaded' | 'error' | 'disabled';
  error?: string;
  /** When `status === 'disabled'`, which scope disabled it (global wins). */
  disabledScope?: 'global' | 'project';
  registration?: PluginRegistration;
}

/** Enablement decision for a plugin id (doc 29 FR-29.16). */
export type EnablementCheck = (id: string) => { disabled: boolean; scope?: 'global' | 'project' };

const ALWAYS_ENABLED: EnablementCheck = () => ({ disabled: false });

/** The global plugins directory (honors `GLASSBOX_CONFIG_DIR`). */
export function pluginsDir(): string { return join(GLOBAL_CONFIG_DIR, 'plugins'); }

/**
 * Discover installed plugin directories — subdirectories, or symlinks that
 * resolve to a directory, under `root`. Dotfiles are skipped; a dangling
 * symlink is skipped, not fatal. Sorted for deterministic load order.
 */
export function discoverPluginDirs(root = pluginsDir()): string[] {
  if (!existsSync(root)) return [];
  let entries: string[];
  try { entries = readdirSync(root); } catch { return []; }
  const out: string[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const dir = join(root, name);
    try { if (statSync(dir).isDirectory()) out.push(dir); } catch { /* dangling symlink */ }
  }
  return out.sort();
}

/** Read a plugin's manifest from `manifest.json`, else `package.json#glassbox`. */
export function readManifest(dir: string): PluginManifest | null {
  const manifestPath = join(dir, 'manifest.json');
  if (existsSync(manifestPath)) {
    try { return parseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8'))); } catch { return null; }
  }
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      const gb = pkg.glassbox;
      if (gb !== null && typeof gb === 'object') {
        return parseManifest({ id: pkg.name, version: pkg.version, entry: pkg.main, ...gb });
      }
    } catch { return null; }
  }
  return null;
}

/** The host context handed to a plugin's `activate`. `getSetting`/`setSetting`
 *  are backed by the manifest-declared preference store (doc 29 FR-29.12). */
function makeContext(manifest: PluginManifest, repoRoot: string): PluginContext {
  const id = manifest.id;
  return {
    log: (level, message) => {
      const line = `[plugin:${id}] ${message}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    },
    getSetting: (key) => Promise.resolve(readPluginSetting(manifest, repoRoot, key)),
    setSetting: (key, value) => { writePluginSetting(manifest, repoRoot, key, value); return Promise.resolve(); },
  };
}

/** Load, activate, and register a single plugin directory. Never throws. A
 *  disabled plugin (per `isEnabled`) is recorded but not activated/registered.
 *  `repoRoot` scopes project-scoped preferences (doc 29 FR-29.12). */
export async function loadPluginDir(dir: string, registry: ContentPluginRegistry, isEnabled: EnablementCheck = ALWAYS_ENABLED, repoRoot = ''): Promise<LoadedPlugin> {
  const manifest = readManifest(dir);
  if (manifest === null) {
    return { id: dir, dir, manifest: null, status: 'error', error: 'invalid or missing manifest' };
  }
  const enablement = isEnabled(manifest.id);
  if (enablement.disabled) {
    return { id: manifest.id, dir, manifest, status: 'disabled', disabledScope: enablement.scope };
  }
  try {
    const entry = join(dir, manifest.entry ?? 'index.js');
    if (!existsSync(entry)) throw new Error(`entry not found: ${manifest.entry ?? 'index.js'}`);
    const mod = (await import(pathToFileURL(entry).href)) as {
      default?: ContentPlugin;
      activate?: ContentPlugin['activate'];
    };
    const plugin: ContentPlugin | undefined =
      mod.default ?? (typeof mod.activate === 'function' ? { activate: mod.activate } : undefined);
    if (plugin === undefined || typeof plugin.activate !== 'function') {
      throw new Error('plugin exports no activate()');
    }
    const registration = (await plugin.activate(makeContext(manifest, repoRoot))) ?? undefined;
    if (registration !== undefined) {
      registry.addRenderers(registration.renderers);
      registry.addDiffers(registration.differs);
    }
    return { id: manifest.id, dir, manifest, status: 'loaded', registration };
  } catch (e) {
    return { id: manifest.id, dir, manifest, status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Discover + load every installed plugin into a fresh registry. Returns the
 * registry and the per-plugin outcomes. A no-op (empty registry) when the
 * subsystem is disabled (doc 29 NFR-29.4).
 */
export async function loadAllPlugins(root = pluginsDir(), isEnabled: EnablementCheck = ALWAYS_ENABLED, repoRoot = ''): Promise<{ registry: ContentPluginRegistry; loaded: LoadedPlugin[] }> {
  const registry = new ContentPluginRegistry();
  if (!PLUGINS_ENABLED) return { registry, loaded: [] };
  const loaded: LoadedPlugin[] = [];
  for (const dir of discoverPluginDirs(root)) {
    loaded.push(await loadPluginDir(dir, registry, isEnabled, repoRoot));
  }
  return { registry, loaded };
}
