/**
 * Plugin manifest schema + parser (doc 29 FR-29.4). Every plugin carries a
 * `manifest.json` (or a `package.json` with a `glassbox` field) declaring at
 * least its id, name, version, entry point, and the content types it handles.
 * Zod validation here is the **single trust boundary** of the loader: a plugin
 * whose manifest fails validation is skipped (fail-soft, FR-29.6).
 */
import { z } from 'zod';

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
    /** Per-project vs global storage (default global). */
    scope: z.enum(['global', 'project']).optional(),
    /** Secret prefs (keychain-backed) are a follow-up (GB-1054); declaring one is
     *  accepted but currently stored like a normal pref, so avoid it for secrets. */
    secret: z.boolean().optional(),
  })
  .loose();
export type PluginPreference = z.infer<typeof PluginPreferenceSchema>;

/** `.loose()` so a manifest may carry extra keys (e.g. plugin-specific config)
 *  without failing validation — only the fields the host reads are asserted. */
export const PluginManifestSchema = z
  .object({
    id: z.string().min(1),
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
