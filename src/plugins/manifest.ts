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
