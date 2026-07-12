/**
 * Public entry point for the content-plugin subsystem (doc 29). Owns the
 * process-global registry, loads plugins once at startup, and exposes the
 * dispatch helpers (`renderContent` / `diffContent`) the render paths call.
 *
 * Every dispatch helper returns `null` when the subsystem is disabled, no
 * plugin matches, or the plugin errors — so a caller always has a clean
 * fall-through to the built-in view (doc 29 FR-29.14). With no plugins
 * installed (the default), dispatch is a cheap no-op (NFR-29.3).
 */
import { PLUGINS_ENABLED } from '../feature-flags.js';
import { disabledScope, readEnablementLists, readGlobalDisabled, readProjectDisabled } from './enablement.js';
import { installBundledPlugins } from './install.js';
import { type EnablementCheck,loadAllPlugins,type LoadedPlugin } from './loader.js';
import { ContentPluginRegistry } from './registry.js';
import type { DiffInput, RenderedView, RenderInput } from './types.js';

let registry = new ContentPluginRegistry();
let loadedPlugins: LoadedPlugin[] = [];
let initialized = false;
/** The repo the subsystem was last (re)loaded for — used to recompute
 *  per-project enablement on reload. */
let currentRepoRoot = '';

export { type LoadedPlugin } from './loader.js';
export type { DiffInput, RenderedView, RenderInput } from './types.js';

/** Whether the content-plugin subsystem is enabled (the kill-switch). */
export function pluginsEnabled(): boolean { return PLUGINS_ENABLED; }

/** Build the enablement predicate for `repoRoot` from the disable lists. */
function enablementCheckFor(repoRoot: string): EnablementCheck {
  const lists = readEnablementLists(repoRoot);
  return (id) => {
    const scope = disabledScope(id, lists);
    return scope === null ? { disabled: false } : { disabled: true, scope };
  };
}

async function loadFor(repoRoot: string): Promise<void> {
  // Seed ~/.glassbox/plugins/ from bundled first-party plugins (desktop
  // delivery, GB-1039) before discovery. Fail-soft: never throws.
  installBundledPlugins();
  const res = await loadAllPlugins(undefined, enablementCheckFor(repoRoot));
  registry = res.registry;
  loadedPlugins = res.loaded;
  currentRepoRoot = repoRoot;
  const failed = loadedPlugins.filter((p) => p.status === 'error').length;
  const disabled = loadedPlugins.filter((p) => p.status === 'disabled').length;
  if (loadedPlugins.length > 0) {
    const parts = [`${loadedPlugins.length - failed - disabled} loaded`];
    if (disabled > 0) parts.push(`${disabled} disabled`);
    if (failed > 0) parts.push(`${failed} failed`);
    console.log(`  Content plugins: ${parts.join(', ')}.`);
  }
}

/**
 * Discover + load all installed content plugins once for `repoRoot` (honoring
 * per-project + global enablement). Idempotent and fail-soft: a broken plugin is
 * recorded, never fatal, and this never throws.
 */
export async function initContentPlugins(repoRoot = ''): Promise<void> {
  if (initialized) return;
  initialized = true;
  if (!PLUGINS_ENABLED) return;
  try {
    await loadFor(repoRoot);
  } catch (e) {
    console.warn(`  Content plugins failed to load: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Re-run install + discovery + load for `repoRoot` — used after an
 * install / uninstall / enable-disable so the change takes effect without a
 * restart (the management UI, GB-1040). Fail-soft.
 */
export async function reloadContentPlugins(repoRoot = currentRepoRoot): Promise<void> {
  if (!PLUGINS_ENABLED) return;
  initialized = true;
  try {
    await loadFor(repoRoot);
  } catch (e) {
    console.warn(`  Content plugins failed to reload: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The per-plugin load outcomes (for the management UI, GB-1040). */
export function getLoadedPlugins(): readonly LoadedPlugin[] { return loadedPlugins; }

/** One installed plugin's descriptive state for the management UI. */
export interface InstalledPluginInfo {
  id: string;
  name: string;
  version: string;
  extensions: string[];
  status: LoadedPlugin['status'];
  error?: string;
  enabled: boolean;
  disabledScope?: 'global' | 'project';
  globalDisabled: boolean;
  projectDisabled: boolean;
}

/**
 * Describe every installed plugin for the management UI (doc 29, GB-1040):
 * status + the two independent disable flags, computed against `repoRoot`.
 */
export function describeInstalledPlugins(repoRoot: string): InstalledPluginInfo[] {
  const globalDisabled = new Set(readGlobalDisabled());
  const projectDisabled = new Set(readProjectDisabled(repoRoot));
  return loadedPlugins.map((p) => {
    const extensions = (p.manifest?.contentTypes ?? []).flatMap((ct) => ct.extensions ?? []);
    return {
      id: p.id,
      name: p.manifest?.name ?? p.id,
      version: p.manifest?.version ?? '0',
      extensions,
      status: p.status,
      error: p.error,
      enabled: p.status === 'loaded',
      disabledScope: p.disabledScope,
      globalDisabled: globalDisabled.has(p.id),
      projectDisabled: projectDisabled.has(p.id),
    };
  });
}

/**
 * Cheap path-only pre-check: could any installed plugin handle a file at `path`
 * (by extension / MIME)? Lets the file-diff-viewer integration skip reading a
 * file's content unless a plugin might render it (NFR-29.3). Always `false` when
 * disabled.
 */
export function mightHandleFile(path: string, mime?: string): boolean {
  return PLUGINS_ENABLED && registry.mightHandleByPath(path, mime);
}

function usableView(view: RenderedView | undefined): RenderedView | null {
  if (view === undefined) return null;
  const svg = typeof view.svg === 'string' && view.svg !== '';
  const html = typeof view.html === 'string' && view.html !== '';
  return svg || html ? view : null;
}

/**
 * Render a single content blob with the best-matching plugin renderer, or
 * `null` if disabled / no match / the renderer errors.
 */
export async function renderContent(input: RenderInput): Promise<RenderedView | null> {
  if (!PLUGINS_ENABLED) return null;
  const renderer = registry.findRenderer(input);
  if (renderer === undefined) return null;
  try {
    return usableView(await renderer.render(input));
  } catch {
    return null;
  }
}

/**
 * Diff a content pair with the best-matching plugin differ, or `null` if
 * disabled / no match / the differ errors.
 */
export async function diffContent(input: DiffInput): Promise<RenderedView | null> {
  if (!PLUGINS_ENABLED) return null;
  const differ = registry.findDiffer(input);
  if (differ === undefined) return null;
  try {
    return usableView(await differ.diff(input));
  } catch {
    return null;
  }
}

/**
 * Test seam: install a hand-built registry (+ optional load outcomes) and mark
 * the subsystem initialized, so a unit test can exercise dispatch without
 * touching the filesystem. Not for production use.
 */
export function __setContentRegistryForTest(r: ContentPluginRegistry, loaded: LoadedPlugin[] = []): void {
  registry = r;
  loadedPlugins = loaded;
  initialized = true;
}

/** Test seam: reset to the empty, uninitialized state. */
export function __resetContentPluginsForTest(): void {
  registry = new ContentPluginRegistry();
  loadedPlugins = [];
  initialized = false;
}
