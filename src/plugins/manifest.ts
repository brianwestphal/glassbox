/**
 * Plugin manifest schema + parser (doc 29 FR-29.4). Every plugin carries a
 * `manifest.json` (or a `package.json` with a `glassbox` field) declaring at
 * least its id, name, version, entry point, and the content types it handles.
 * Zod validation here is the **single trust boundary** of the loader: a plugin
 * whose manifest fails validation is skipped (fail-soft, FR-29.6).
 */
import { z } from 'zod';

import { SAFE_SLUG_RE } from '../utils/safeSlug.js';

const ContentTypeSchema = z
  .object({
    extensions: z.array(z.string()).optional(),
    mimeTypes: z.array(z.string()).optional(),
  })
  .loose();

/** A manifest-declared plugin preference (doc 29 FR-29.12, GB-1047). The plugin
 *  reads it via `PluginContext.getSetting(key)`; the Settings → Plugins tab
 *  renders it and auto-saves. */
export const PluginPreferenceSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(['string', 'number', 'boolean', 'select']),
    /** Stored as a string; the plugin coerces. */
    default: z.string().optional(),
    description: z.string().optional(),
    /** `select` options (value === label unless an object form is used later). */
    options: z.array(z.string()).optional(),
    /** Per-project vs global storage (default global). Ignored for secrets
     *  (always keychain). */
    scope: z.enum(['global', 'project']).optional(),
    /** Secret prefs are stored in the OS keychain, never in config (GB-1054). */
    secret: z.boolean().optional(),
  })
  .loose();
export type PluginPreference = z.infer<typeof PluginPreferenceSchema>;

/** A dynamic config-layout label's semantic tone (doc 29 FR-29.18); the host
 *  maps each tone to the actual UI color. Mirrors `ConfigLabelColor` in types.ts. */
export const ConfigLabelColorSchema = z.enum(['default', 'success', 'error', 'warning', 'transient']);
export type ConfigLabelColor = z.infer<typeof ConfigLabelColorSchema>;

/**
 * One node of a plugin's optional `configLayout` (doc 29 FR-29.18) — how the
 * Settings → Plugins tab arranges its preferences. Recursive (`group` nests), so
 * the interface is declared explicitly and the schema is `z.lazy`-wrapped.
 * A `preference` item references a declared preference by `key`; if `configLayout`
 * is omitted the preferences render as a flat list.
 */
export interface ConfigLayoutItem {
  type: 'preference' | 'divider' | 'spacer' | 'label' | 'button' | 'group';
  /** `preference`: the preference key to render. */
  key?: string;
  /** `label`/`button`: a stable id (labels are addressed by `updateConfigLabel`). */
  id?: string;
  /** `label`: the initial text. */
  text?: string;
  /** `label`: the initial tone. */
  color?: ConfigLabelColor;
  /** `button`: the button caption. */
  label?: string;
  /** `button`: the action id passed to the plugin's `onAction`. */
  action?: string;
  /** `button`: `'primary'` renders the accent style. */
  style?: string;
  /** `group`: the section heading. */
  title?: string;
  /** `group`: whether the section starts collapsed (default open). */
  collapsed?: boolean;
  /** `group`: the nested items. */
  items?: ConfigLayoutItem[];
}
export const ConfigLayoutItemSchema: z.ZodType<ConfigLayoutItem> = z.lazy(() =>
  z
    .object({
      type: z.enum(['preference', 'divider', 'spacer', 'label', 'button', 'group']),
      key: z.string().optional(),
      id: z.string().optional(),
      text: z.string().optional(),
      color: ConfigLabelColorSchema.optional(),
      label: z.string().optional(),
      action: z.string().optional(),
      style: z.string().optional(),
      title: z.string().optional(),
      collapsed: z.boolean().optional(),
      items: z.array(ConfigLayoutItemSchema).optional(),
    })
    .loose(),
);

/**
 * A system requirement an opt-in plugin needs before it can render (doc 29
 * §29.2, GB-1069) — e.g. a JRE for PlantUML, `npm` for Mermaid. The host checks
 * readiness by running `command <checkArgs>`; if it's missing (or non-zero), the
 * UI shows `hint` (and `docUrl`) so the user can install it, then retry. A
 * requirement is something the host can't install for the user; it can only
 * detect + instruct.
 */
export const PluginRequirementSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    /** Executable whose presence proves the requirement (run with `checkArgs`). */
    command: z.string().min(1),
    /** Args for the presence check (default `['--version']`). */
    checkArgs: z.array(z.string()).optional(),
    /** Human remediation shown when the requirement is missing. */
    hint: z.string().min(1),
    docUrl: z.string().optional(),
  })
  .loose();
export type PluginRequirement = z.infer<typeof PluginRequirementSchema>;

/**
 * A provisioning step the host performs automatically at install (the "auto-fix
 * where possible" half of GB-1069). `fetch` downloads a URL into the install dir
 * (needs no external tooling — always runnable); `npm-install` runs `npm install`
 * into the install dir (needs the `npm` requirement, and downloads whatever the
 * packages pull, e.g. a Chromium — so its `note` warns the user).
 */
export const PluginProvisionStepSchema = z.union([
  z
    .object({
      kind: z.literal('fetch'),
      url: z.string().min(1),
      /** Destination filename inside the install dir. */
      dest: z.string().min(1),
      /** Optional expected sha-256 (hex) of the downloaded bytes. */
      sha256: z.string().optional(),
    })
    .loose(),
  z
    .object({
      kind: z.literal('npm-install'),
      packages: z.array(z.string().min(1)).min(1),
      /** Requirement id whose command must be present to run this (default `npm`). */
      requires: z.string().optional(),
      note: z.string().optional(),
    })
    .loose(),
]);
export type PluginProvisionStep = z.infer<typeof PluginProvisionStepSchema>;

/**
 * An opt-in plugin's install descriptor (doc 29 §29.2, GB-1069). Drives the
 * "Available to install" UI: the host checks `requirements`, runs the
 * auto-fixable `provision` steps whose prerequisites are met, and reports the
 * rest as actionable instructions. A plugin with no `install` descriptor (or an
 * empty one) is **self-contained** — installing it is just copying the bundle.
 */
export const PluginInstallSchema = z
  .object({
    requirements: z.array(PluginRequirementSchema).optional(),
    provision: z.array(PluginProvisionStepSchema).optional(),
    /** Fallback command to run by hand when auto-provisioning can't complete. */
    cliHint: z.string().optional(),
  })
  .loose();
export type PluginInstall = z.infer<typeof PluginInstallSchema>;

/** `.loose()` so a manifest may carry extra keys (e.g. plugin-specific config)
 *  without failing validation — only the fields the host reads are asserted. */
export const PluginManifestSchema = z
  .object({
    // The id is used as a filesystem path segment (install/uninstall under the
    // plugins dir, ahead of a recursive rmSync) and in keychain account names,
    // so it must be a safe slug: no path separators, no leading dot (doc 14).
    id: z.string().regex(SAFE_SLUG_RE, 'plugin id must be alphanumeric with . _ - (no path separators, no leading dot)'),
    name: z.string().min(1),
    version: z.string().min(1),
    /** Entry module relative to the plugin dir; defaults to `index.js`. */
    entry: z.string().min(1).optional(),
    description: z.string().optional(),
    author: z.string().optional(),
    /** The content types this plugin handles (informational for the UI; the
     *  authoritative match lives in the registered renderer/differ). */
    contentTypes: z.array(ContentTypeSchema).optional(),
    /** User-configurable preferences (doc 29 FR-29.12); rendered in Settings. */
    preferences: z.array(PluginPreferenceSchema).optional(),
    /** Optional arrangement of the preferences into groups/dividers/labels/
     *  buttons (doc 29 FR-29.18). Omitted → flat preference list. */
    configLayout: z.array(ConfigLayoutItemSchema).optional(),
    /** `false` marks a **separately-installable** plugin (e.g. one with a system
     *  requirement like Java): it's built + may ship in the bundle, but
     *  `installBundledPlugins` does NOT auto-install it — the user opts in
     *  (GB-1046). Defaults to auto-install (true) when omitted. */
    autoInstall: z.boolean().optional(),
    /** How to install an opt-in plugin from the UI (doc 29 §29.2, GB-1069):
     *  system requirements + auto-run provisioning steps. Absent → self-contained. */
    install: PluginInstallSchema.optional(),
  })
  .loose();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * Parse a raw manifest object. Returns `null` (never throws) on an invalid
 * shape so the loader can skip the plugin without crashing startup.
 */
export function parseManifest(raw: unknown): PluginManifest | null {
  const parsed = PluginManifestSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
