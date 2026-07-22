/**
 * Enumerate opt-in plugins that ship in the bundle but aren't installed yet
 * (doc 29 §29.2, GB-1069). These are the `autoInstall: false` plugins
 * `installBundledPlugins` deliberately skips (e.g. PlantUML, Mermaid) — surfaced
 * in Settings → Plugins as "Available to install" so a desktop user can opt in
 * with a click instead of running a CLI `setup.mjs`.
 *
 * Each entry carries a **readiness report** (its manifest requirements checked
 * against the system) + notes about what installing will provision, so the UI
 * can auto-fix what it can and give specific instructions for the rest.
 */
import { existsSync } from 'fs';
import { join } from 'path';

import { bundledPluginsDir, discoverBundledPlugins } from './install.js';
import { pluginsDir, readManifest } from './loader.js';
import type { PluginInstall, PluginManifest } from './manifest.js';
import { checkRequirements, type CommandProbe, type RequirementStatus } from './readiness.js';

/** One opt-in plugin available to install, with its readiness report. */
export interface AvailablePlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Extensions its content types declare (informational). */
  extensions: string[];
  /** System requirements, each checked against the current machine. */
  requirements: RequirementStatus[];
  /** Human notes about what installing provisions (e.g. a large download). */
  provisionNotes: string[];
  /** True when it needs no requirements + no provisioning — install is just a copy. */
  selfContained: boolean;
  /** A fallback CLI command, when the manifest declares one. */
  cliHint?: string;
}

/** Extensions declared across a manifest's content types. */
function manifestExtensions(manifest: PluginManifest): string[] {
  return (manifest.contentTypes ?? []).flatMap((ct) => ct.extensions ?? []);
}

/** Notes describing what a plugin's provision steps will do. */
function provisionNotes(install: PluginInstall | undefined): string[] {
  const notes: string[] = [];
  for (const step of install?.provision ?? []) {
    if (step.kind === 'fetch') notes.push(`Downloads ${step.dest}.`);
    else notes.push(step.note ?? `Installs ${step.packages.join(', ')}.`); // npm-install
  }
  return notes;
}

/** Build the available-plugin descriptor for a bundled manifest. */
export function describeAvailablePlugin(manifest: PluginManifest, runProbe?: CommandProbe): AvailablePlugin {
  const requirements = checkRequirements(manifest.install?.requirements, runProbe);
  const notes = provisionNotes(manifest.install);
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    extensions: manifestExtensions(manifest),
    requirements,
    provisionNotes: notes,
    selfContained: requirements.length === 0 && notes.length === 0,
    cliHint: manifest.install?.cliHint,
  };
}

/**
 * List opt-in (`autoInstall: false`) bundled plugins that are not currently
 * installed in `userDir`, each with a readiness report. An already-installed
 * plugin is omitted (it shows in the installed list instead).
 */
export function listAvailablePlugins(opts?: { bundledDir?: string; userDir?: string; runProbe?: CommandProbe }): AvailablePlugin[] {
  const bundledDir = opts?.bundledDir ?? bundledPluginsDir();
  const userDir = opts?.userDir ?? pluginsDir();
  const out: AvailablePlugin[] = [];
  for (const { manifest } of discoverBundledPlugins(bundledDir)) {
    if (manifest.autoInstall !== false) continue; // only opt-in plugins are "available to install"
    if (existsSync(join(userDir, manifest.id))) continue; // already installed
    out.push(describeAvailablePlugin(manifest, opts?.runProbe));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The bundled manifest for an id (for the install action), or null. */
export function bundledManifestById(id: string, bundledDir: string = bundledPluginsDir()): PluginManifest | null {
  return discoverBundledPlugins(bundledDir).find((b: { manifest: PluginManifest }) => b.manifest.id === id)?.manifest ?? readManifest(join(bundledDir, id));
}
