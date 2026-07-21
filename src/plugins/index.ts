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
import type { AnnotationWithFilePath, Review } from '../db/schemas.js';
import { PLUGINS_ENABLED } from '../feature-flags.js';
import { disabledScope, readEnablementLists, readGlobalDisabled, readProjectDisabled } from './enablement.js';
import { installBundledPlugins } from './install.js';
import { clearAllPluginUIElements, type EnablementCheck, getConfigLabelOverride, getPluginUIElements, loadAllPlugins,type LoadedPlugin } from './loader.js';
import type { ConfigLayoutItem, PluginManifest, PluginPreference } from './manifest.js';
import { ContentPluginRegistry } from './registry.js';
import { readPluginPreferenceDisplay, readPluginSetting, writePluginSetting } from './settings.js';
import type { AnnotationHookInfo, ConfigLabelColor, DecodedImage, DiffInput, PluginUIElement, RenderedView, RenderInput, ReviewHookInfo, UIActionResult } from './types.js';

let registry = new ContentPluginRegistry();
let loadedPlugins: LoadedPlugin[] = [];
let initialized = false;
/** The repo the subsystem was last (re)loaded for — used to recompute
 *  per-project enablement on reload. */
let currentRepoRoot = '';

export { type LoadedPlugin } from './loader.js';
export type { DecodedImage, DiffInput, RenderedView, RenderInput } from './types.js';

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
  // Drop stale UI-element registrations (doc 30) so only plugins that re-activate
  // (i.e. are still enabled) re-register — a disabled plugin's elements disappear.
  clearAllPluginUIElements();
  const res = await loadAllPlugins(undefined, enablementCheckFor(repoRoot), repoRoot);
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
  /** Manifest-declared preferences + their current values (doc 29 FR-29.12).
   *  Secret values are never included; `secretConfigured` lists the secret pref
   *  keys that have a stored value (GB-1054). */
  preferences: PluginPreference[];
  preferenceValues: Record<string, string>;
  secretConfigured: string[];
  /** Optional manifest arrangement of the preferences (doc 29 FR-29.18). */
  configLayout?: ConfigLayoutItem[];
  /** Every `label` item's effective text/color (manifest default merged with any
   *  runtime `updateConfigLabel` override), keyed by label id (doc 29 FR-29.18). */
  configLabels: Record<string, { text: string; color?: ConfigLabelColor }>;
}

/** Resolve a plugin's config-layout labels: each `label` item's effective
 *  text/color = the runtime override (if any) else the manifest defaults. */
function resolveConfigLabels(manifest: PluginManifest): Record<string, { text: string; color?: ConfigLabelColor }> {
  const out: Record<string, { text: string; color?: ConfigLabelColor }> = {};
  const walk = (items: ConfigLayoutItem[] | undefined): void => {
    for (const item of items ?? []) {
      if (item.type === 'label' && item.id !== undefined && item.id !== '') {
        const override = getConfigLabelOverride(manifest.id, item.id);
        out[item.id] = override ?? { text: item.text ?? '', color: item.color };
      }
      if (item.type === 'group') walk(item.items);
    }
  };
  walk(manifest.configLayout);
  return out;
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
    const display = p.manifest ? readPluginPreferenceDisplay(p.manifest, repoRoot) : { values: {}, secretConfigured: [] };
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
      preferences: p.manifest?.preferences ?? [],
      preferenceValues: display.values,
      secretConfigured: display.secretConfigured,
      configLayout: p.manifest?.configLayout,
      configLabels: p.manifest ? resolveConfigLabels(p.manifest) : {},
    };
  });
}

/** The manifest for a loaded plugin id (for the preference setter). */
export function getPluginManifest(id: string): PluginManifest | undefined {
  return loadedPlugins.find((p) => p.id === id)?.manifest ?? undefined;
}

/**
 * Invoke a loaded plugin's config-layout `button` action (doc 29 FR-29.18).
 * Runs the plugin's `onAction(actionId, context)` with the context it was
 * activated with (so `updateConfigLabel` targets the shared override map).
 * Throws if the plugin isn't loaded or declares no `onAction` — the route
 * surfaces the message; the label overrides it set are read on the next
 * `describeInstalledPlugins`.
 */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- onAction may return nothing (void) or a result
export async function runPluginAction(id: string, actionId: string, value?: string): Promise<UIActionResult | void> {
  if (!PLUGINS_ENABLED) throw new Error('Plugins are disabled');
  const loaded = loadedPlugins.find((p) => p.id === id);
  if (loaded === undefined || loaded.status !== 'loaded' || loaded.instance === undefined || loaded.context === undefined) {
    throw new Error('Plugin not active');
  }
  if (typeof loaded.instance.onAction !== 'function') {
    throw new Error('Plugin does not handle actions');
  }
  return await loaded.instance.onAction(actionId, loaded.context, value);
}

/** A stateful control's `stateKey` (toggle/switch/segmented-control, doc 30), else undefined. */
function statefulKey(e: PluginUIElement): string | undefined {
  return e.type === 'toggle' || e.type === 'switch' || e.type === 'segmented-control' ? e.stateKey : undefined;
}

/** An element's action id (every type except `link`). */
function elementAction(e: PluginUIElement): string | undefined {
  return e.type === 'link' ? undefined : e.action;
}

/**
 * Persist a stateful UI control's new value to its `stateKey` (doc 30 FR-30.3):
 * finds the registered element by `(id, actionId)`, and if it declares a
 * `stateKey`, writes `value` to that plugin setting (the host reflects state so
 * plugin authors get persistence for free). Fail-soft; a no-op for a plain
 * button (no stateKey) or an unknown element.
 */
export function persistPluginUIState(id: string, actionId: string, value: string, repoRoot: string): void {
  const manifest = loadedPlugins.find((p) => p.id === id && p.status === 'loaded')?.manifest;
  if (manifest === null || manifest === undefined) return;
  const group = getPluginUIElements().find((g) => g.pluginId === id);
  const el = group?.elements.find((e) => elementAction(e) === actionId && statefulKey(e) !== undefined && statefulKey(e) !== '');
  const key = el ? statefulKey(el) : undefined;
  if (key === undefined || key === '') return;
  try { writePluginSetting(manifest, repoRoot, key, value); }
  catch { /* fail-soft: persistence best-effort */ }
}

function toReviewHookInfo(review: Review): ReviewHookInfo {
  return { id: review.id, repoPath: review.repo_path, repoName: review.repo_name, mode: review.mode, status: review.status };
}

function toAnnotationHookInfo(a: AnnotationWithFilePath): AnnotationHookInfo {
  return { id: a.id, filePath: a.file_path, lineNumber: a.line_number, side: a.side, category: a.category, content: a.content };
}

/**
 * Fire every loaded plugin's `onReviewCreated` hook (doc 31 FR-31.3), fail-soft:
 * a throwing hook is logged and skipped, never propagated. No-op when disabled.
 */
export async function notifyReviewCreated(review: Review): Promise<void> {
  if (!PLUGINS_ENABLED) return;
  const info = toReviewHookInfo(review);
  for (const p of loadedPlugins) {
    const hook = p.registration?.reviewHooks?.onReviewCreated;
    if (p.status !== 'loaded' || hook === undefined || p.context === undefined) continue;
    try { await hook(info, p.context); }
    catch (e) { console.warn(`  [plugin:${p.id}] onReviewCreated hook failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
}

/**
 * Fire every loaded plugin's `onReviewCompleted` hook (doc 31 FR-31.3) with the
 * review, its annotations, and the export path. Fail-soft. No-op when disabled.
 */
export async function notifyReviewCompleted(review: Review, annotations: AnnotationWithFilePath[], exportPath: string): Promise<void> {
  if (!PLUGINS_ENABLED) return;
  const info = toReviewHookInfo(review);
  const anns = annotations.map(toAnnotationHookInfo);
  for (const p of loadedPlugins) {
    const hook = p.registration?.reviewHooks?.onReviewCompleted;
    if (p.status !== 'loaded' || hook === undefined || p.context === undefined) continue;
    try { await hook(info, anns, exportPath, p.context); }
    catch (e) { console.warn(`  [plugin:${p.id}] onReviewCompleted hook failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
}

/**
 * The registered UI elements (doc 30 FR-30.4) of currently-loaded (enabled)
 * plugins, each flattened with its `pluginId`, for the client to render. Empty
 * when the subsystem is disabled.
 */
export function listPluginUIElements(repoRoot = ''): (PluginUIElement & { pluginId: string; value?: string })[] {
  if (!PLUGINS_ENABLED) return [];
  const loaded = new Map(loadedPlugins.filter((p) => p.status === 'loaded').map((p) => [p.id, p]));
  const out: (PluginUIElement & { pluginId: string; value?: string })[] = [];
  for (const { pluginId, elements } of getPluginUIElements()) {
    const plugin = loaded.get(pluginId);
    if (plugin === undefined) continue;
    for (const el of elements) {
      // Attach the resolved current state for a stateful control (doc 30 FR-30.3)
      // by reading its stateKey setting, so the client renders it in that state.
      const key = statefulKey(el);
      const value = key !== undefined && key !== '' && plugin.manifest !== null
        ? readPluginSetting(plugin.manifest, repoRoot, key) ?? undefined
        : undefined;
      out.push({ ...el, pluginId, value });
    }
  }
  return out;
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
 * Decode an image's bytes to RGBA with the best-matching plugin image decoder
 * (doc 29 imageDecoders capability), or `null` if disabled / no match / the
 * decoder returns null or throws. Lets the perceptual diff (doc 26 P2) score a
 * format core can't decode (WebP/AVIF/…) when a codec plugin is installed.
 */
export async function decodeImageWithPlugin(bytes: Uint8Array, path: string, mime?: string): Promise<DecodedImage | null> {
  if (!PLUGINS_ENABLED) return null;
  const decoder = registry.findImageDecoder({ bytes, path, mime });
  if (decoder === undefined) return null;
  try {
    return (await decoder.decode({ bytes, path })) ?? null;
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
