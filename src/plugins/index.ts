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
import { installBundledPlugins } from './install.js';
import { loadAllPlugins,type LoadedPlugin } from './loader.js';
import { ContentPluginRegistry } from './registry.js';
import type { DiffInput, RenderedView, RenderInput } from './types.js';

let registry = new ContentPluginRegistry();
let loadedPlugins: LoadedPlugin[] = [];
let initialized = false;

export { type LoadedPlugin } from './loader.js';
export type { DiffInput, RenderedView, RenderInput } from './types.js';

/** Whether the content-plugin subsystem is enabled (the kill-switch). */
export function pluginsEnabled(): boolean { return PLUGINS_ENABLED; }

/**
 * Discover + load all installed content plugins once. Idempotent and fail-soft:
 * a broken plugin is recorded, never fatal, and this never throws.
 */
export async function initContentPlugins(): Promise<void> {
  if (initialized) return;
  initialized = true;
  if (!PLUGINS_ENABLED) return;
  try {
    // Seed ~/.glassbox/plugins/ from bundled first-party plugins (desktop
    // delivery, GB-1039) before discovery. Fail-soft: never throws.
    installBundledPlugins();
    const res = await loadAllPlugins();
    registry = res.registry;
    loadedPlugins = res.loaded;
    const failed = loadedPlugins.filter((p) => p.status === 'error').length;
    if (loadedPlugins.length > 0) {
      console.log(`  Content plugins: ${loadedPlugins.length - failed} loaded${failed > 0 ? `, ${failed} failed` : ''}.`);
    }
  } catch (e) {
    console.warn(`  Content plugins failed to load: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The per-plugin load outcomes (for the management UI, GB-1040). */
export function getLoadedPlugins(): readonly LoadedPlugin[] { return loadedPlugins; }

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
