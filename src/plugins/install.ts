/**
 * Desktop delivery for content plugins (doc 29 FR-29.7, GB-1039). First-party
 * plugins are esbuild-bundled into `dist/plugins/<id>/` and copied into the
 * Tauri sidecar (`server/plugins`) by `build-sidecar.sh`. Because an end user
 * can't `npm install` into a packaged `.app`, this module — run at startup —
 * **auto-installs** those bundled plugins into `~/.glassbox/plugins/` (from
 * which the loader discovers them), with a version + content-hash freshness
 * check and a dismiss-list so a user's uninstall of a bundled plugin sticks.
 *
 * Also provides the install-from-disk / uninstall mechanisms the management UI
 * (GB-1040) drives. Mirrors Hot Sheet's `installBundledPlugins` / `hashPluginDir`
 * / dismissed-plugins model.
 */
import { createHash } from 'crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { compareVersions } from '../utils/compareVersions.js';
import { pluginsDir, readManifest } from './loader.js';
import type { PluginManifest } from './manifest.js';

const DISMISSED_FILE = 'dismissed-plugins.json';

/** The dismiss-list lives next to the plugins dir (i.e. in the config dir —
 *  `~/.glassbox/dismissed-plugins.json` when the plugins dir is `~/.glassbox/plugins`). */
function dismissedPathFor(userDir: string): string {
  return join(dirname(userDir), DISMISSED_FILE);
}

/**
 * Where first-party plugins are bundled: next to the running server bundle
 * (prod: `server/plugins`, since the whole server is bundled into one `cli.js`),
 * else the dev build output (`dist/plugins`).
 */
export function bundledPluginsDir(): string {
  // `GLASSBOX_BUNDLED_PLUGINS_DIR` relocates the bundle (used by tests + any
  // deployment that ships plugins elsewhere), mirroring `GLASSBOX_CONFIG_DIR`.
  const override = process.env.GLASSBOX_BUNDLED_PLUGINS_DIR;
  if (override !== undefined && override.trim() !== '') return override;
  const sibling = join(dirname(fileURLToPath(import.meta.url)), 'plugins');
  if (existsSync(sibling)) return sibling;
  return join(process.cwd(), 'dist', 'plugins');
}

/** One bundled plugin: its directory + validated manifest. */
export interface BundledPlugin {
  dir: string;
  manifest: PluginManifest;
}

/**
 * Every bundled plugin under `bundledDir` (each subdir with a valid manifest),
 * sorted by id. Shared by `installBundledPlugins` (auto-install), the
 * available-to-install list, and the install action (GB-1069). Fail-soft.
 */
export function discoverBundledPlugins(bundledDir: string = bundledPluginsDir()): BundledPlugin[] {
  if (!existsSync(bundledDir)) return [];
  let entries: string[];
  try { entries = readdirSync(bundledDir); } catch { return []; }
  const out: BundledPlugin[] = [];
  for (const name of entries.sort()) {
    const dir = join(bundledDir, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      const manifest = readManifest(dir);
      if (manifest !== null) out.push({ dir, manifest });
    } catch { /* skip a bad bundled plugin */ }
  }
  return out;
}

export function readDismissed(userDir: string = pluginsDir()): string[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(dismissedPathFor(userDir), 'utf-8'));
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[], userDir: string): void {
  const path = dismissedPathFor(userDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify([...new Set(ids)], null, 2), 'utf-8');
}

export { compareVersions } from '../utils/compareVersions.js';

/** sha-1 over a directory's files (path + bytes), sorted — a content fingerprint. */
export function hashPluginDir(dir: string): string {
  const h = createHash('sha1');
  const walk = (d: string, rel: string): void => {
    for (const name of readdirSync(d).sort()) {
      const abs = join(d, name);
      const r = rel === '' ? name : `${rel}/${name}`;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else { h.update(r); h.update(readFileSync(abs)); }
    }
  };
  walk(dir, '');
  return h.digest('hex');
}

/** Decide whether the bundled plugin at `src` should (re)install over `dest`. */
export function shouldInstall(src: string, dest: string, bundledVersion: string): boolean {
  if (!existsSync(dest)) return true;
  const destManifest = readManifest(dest);
  const destVersion = destManifest?.version ?? '0';
  const cmp = compareVersions(bundledVersion, destVersion);
  if (cmp > 0) return true; // bundled is newer
  if (cmp < 0) return false; // installed is newer — leave the user's copy
  // Same version: reinstall only if the content differs (a same-version rebuild).
  try {
    return hashPluginDir(src) !== hashPluginDir(dest);
  } catch {
    return false;
  }
}

/**
 * Seed `~/.glassbox/plugins/` from the bundled plugins. Fail-soft: never throws;
 * a bad bundled plugin is skipped. Dismissed ids are left uninstalled.
 */
export function installBundledPlugins(opts?: { bundledDir?: string; userDir?: string }): void {
  const bundledDir = opts?.bundledDir ?? bundledPluginsDir();
  const userDir = opts?.userDir ?? pluginsDir();
  if (!existsSync(bundledDir)) return;
  const dismissed = new Set(readDismissed(userDir));
  let entries: string[];
  try { entries = readdirSync(bundledDir); } catch { return; }
  for (const name of entries) {
    const src = join(bundledDir, name);
    try {
      if (!statSync(src).isDirectory()) continue;
      const manifest = readManifest(src);
      if (manifest === null || dismissed.has(manifest.id)) continue;
      // Separately-installable plugins (e.g. PlantUML, which needs Java) are not
      // force-installed — the user opts in (GB-1046, doc 29 FR-29.7).
      if (manifest.autoInstall === false) continue;
      const dest = join(userDir, manifest.id);
      if (!shouldInstall(src, dest, manifest.version)) continue;
      mkdirSync(userDir, { recursive: true });
      rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
    } catch { /* skip a single bad plugin; never break startup */ }
  }
}

/**
 * Install a plugin from an arbitrary directory (the management UI's
 * "install from disk", GB-1040): symlink it into `~/.glassbox/plugins/` (falling
 * back to a copy where symlinks aren't permitted), and clear any dismiss so a
 * re-install of a previously-removed bundled plugin takes. Returns the plugin id.
 */
export function installPluginFromDisk(sourceDir: string, opts?: { userDir?: string }): { id: string } {
  const manifest = readManifest(sourceDir);
  if (manifest === null) throw new Error('The selected folder is not a Glassbox plugin (no manifest.json).');
  const userDir = opts?.userDir ?? pluginsDir();
  mkdirSync(userDir, { recursive: true });
  const dest = join(userDir, manifest.id);
  rmSync(dest, { recursive: true, force: true });
  try {
    symlinkSync(sourceDir, dest, 'dir');
  } catch {
    cpSync(sourceDir, dest, { recursive: true });
  }
  writeDismissed(readDismissed(userDir).filter((x) => x !== manifest.id), userDir);
  return { id: manifest.id };
}

/** Remove `id` from the dismiss-list — so an opt-in install (GB-1069) of a
 *  previously-uninstalled bundled plugin takes and isn't re-suppressed. */
export function undismissPlugin(id: string, userDir: string = pluginsDir()): void {
  writeDismissed(readDismissed(userDir).filter((x) => x !== id), userDir);
}

/**
 * Remove an installed plugin and (for a bundled one) record it in the
 * dismiss-list so `installBundledPlugins` doesn't re-add it next startup.
 */
export function uninstallPlugin(id: string, opts?: { userDir?: string }): void {
  const userDir = opts?.userDir ?? pluginsDir();
  rmSync(join(userDir, id), { recursive: true, force: true });
  writeDismissed([...readDismissed(userDir), id], userDir);
}
