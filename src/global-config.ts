import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';

/** Permissive top-level shape of `~/.glassbox/config.json`. Keys vary by
 *  feature (`ai`, `guidedReview`, `sharePrompt`, `themes`, …), so the
 *  schema only asserts it's a JSON object — narrower per-feature schemas
 *  live in the modules that own those keys. */
const GlobalConfigSchema = z.record(z.string(), z.unknown());

/**
 * Single source of truth for `~/.glassbox/` and the global `config.json`
 * shared across the server, the channel toggle, share-prompt state, theme
 * selection, AI preferences, etc. All readers and writers MUST go through
 * `readGlobalConfig` / `updateGlobalConfig` here so concurrent mutations
 * don't clobber each other.
 */
export const GLOBAL_CONFIG_DIR = join(homedir(), '.glassbox');
export const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, 'config.json');

export type GlobalConfig = Record<string, unknown>;

export function readGlobalConfig(): GlobalConfig {
  try {
    if (existsSync(GLOBAL_CONFIG_PATH)) {
      const raw: unknown = JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, 'utf-8'));
      const parsed = GlobalConfigSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }
  } catch { /* corrupt or unreadable — start fresh */ }
  return {};
}

function writeGlobalConfig(config: GlobalConfig): void {
  mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  try { chmodSync(GLOBAL_CONFIG_PATH, 0o600); } catch { /* not all OSes honor this */ }
}

/**
 * Read-modify-write the global config under a single function call. The
 * mutator may return either nothing (mutates in place) or a replacement
 * object. Eliminates the read-snapshot / mutate-one-key / write-back race
 * that existed when each caller re-implemented its own pair of helpers.
 */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- mutator may return nothing (in-place) or a replacement
export function updateGlobalConfig(mutator: (cfg: GlobalConfig) => GlobalConfig | void): void {
  const cfg = readGlobalConfig();
  const result = mutator(cfg);
  writeGlobalConfig(result === undefined ? cfg : result);
}
