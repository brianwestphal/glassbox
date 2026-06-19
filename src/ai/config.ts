import { z } from 'zod';

import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH, readGlobalConfig, updateGlobalConfig } from '../global-config.js';
import { resolveAPIKey as _resolveAPIKey } from './api-keys.js';
import type { AIPlatform } from './models.js';
import { AIPlatformSchema, APPLE_FM_ANALYSIS_ENABLED, getDefaultModel, KEYLESS_PLATFORMS, resolveModelId } from './models.js';

export interface AIConfig {
  platform: AIPlatform;
  model: string;
  apiKey: string | null;
  keySource: 'env' | 'keychain' | 'config' | null;
  /** Base URL for the `local` (OpenAI-compatible) platform. */
  baseUrl?: string;
  /**
   * Secondary config used when the primary platform fails a batch — populated
   * by `loadAIConfig` only when the primary is `apple` and a valid non-apple
   * fallback is configured. One level deep: the fallback never has its own
   * `.fallback`. See `runAnalysisBatch`.
   */
  fallback?: AIConfig;
}

/** Default local endpoint — Ollama's OpenAI-compatible API. */
export const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:11434/v1';

/** The configured local base URL (or the Ollama default), trailing slash
 *  trimmed. */
export function resolveLocalEndpoint(): string {
  const configured = readConfigFile().ai?.localEndpoint?.trim();
  const base = configured !== undefined && configured !== '' ? configured : DEFAULT_LOCAL_ENDPOINT;
  return base.replace(/\/+$/, '');
}

export interface GuidedReviewConfig {
  enabled: boolean;
  topics: string[];
}

export const CONFIG_DIR = GLOBAL_CONFIG_DIR;
export const CONFIG_PATH = GLOBAL_CONFIG_PATH;

/**
 * On-disk shape of `~/.glassbox/config.json` (the slice this module
 * cares about — other modules layer their own keys onto the same
 * object). Validated at read time so a corrupt or human-edited file
 * cannot silently produce a misshapen `ConfigFile`.
 */
export const ConfigFileSchema = z.object({
  ai: z.object({
    platform: z.string().optional(),
    model: z.string().optional(),
    keys: z.record(z.string(), z.string()).optional(),
    localEndpoint: z.string().optional(),
    // Secondary model used when the primary (Apple FM) fails a batch.
    fallbackPlatform: z.string().optional(),
    fallbackModel: z.string().optional(),
  }).optional(),
  guidedReview: z.object({
    enabled: z.boolean().optional(),
    topics: z.array(z.string()).optional(),
  }).optional(),
}).loose();
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

export function readConfigFile(): ConfigFile {
  const raw = readGlobalConfig();
  const parsed = ConfigFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/**
 * Resolve a single platform + (raw) model id into a usable `AIConfig` slice
 * (model remapping, API key, local base URL). Shared by the primary config and
 * the Apple-FM fallback so both go through the same resolution rules. Never
 * sets `.fallback` — that's layered on by `loadAIConfig`.
 */
function resolvePlatformConfig(platform: AIPlatform, rawModelOrUndefined: string | undefined): AIConfig {
  // Resolve a saved preference that may point at a retired/older model id
  // (e.g. a `claude-sonnet-4-*` snapshot) to a currently-offered model so
  // analysis doesn't 404 on a stale config (GB-893). Skip for keyless
  // platforms (local), whose model id is whatever the user's server offers —
  // never a cloud alias to remap.
  const rawModel = rawModelOrUndefined ?? getDefaultModel(platform);
  const model = KEYLESS_PLATFORMS.has(platform) ? rawModel : resolveModelId(platform, rawModel);
  const { key, source } = _resolveAPIKey(platform);
  const baseUrl = platform === 'local' ? resolveLocalEndpoint() : undefined;
  return { platform, model, apiKey: key, keySource: source, baseUrl };
}

export function loadAIConfig(): AIConfig {
  const config = readConfigFile();
  const platformRaw = config.ai?.platform ?? 'anthropic';
  let platform = AIPlatformSchema.safeParse(platformRaw).success
    ? AIPlatformSchema.parse(platformRaw)
    : 'anthropic';
  // Kill-switch: when Apple FM analysis is disabled, a previously-saved `apple`
  // preference falls back to the default so analysis is never routed to the
  // on-device model (see `APPLE_FM_ANALYSIS_ENABLED`).
  if (platform === 'apple' && !APPLE_FM_ANALYSIS_ENABLED) platform = 'anthropic';

  const primary = resolvePlatformConfig(platform, config.ai?.model);

  // When the primary is Apple FM (whose 4096-token window can't fit larger
  // diffs), attach the user-chosen secondary model. Batches that the on-device
  // model can't handle spill to this fallback (`runAnalysisBatch`). Only a valid
  // non-apple selection counts; otherwise there's simply no fallback.
  if (platform === 'apple') {
    const fallback = resolveFallbackConfig(config);
    if (fallback !== null) primary.fallback = fallback;
  }

  return primary;
}

/** The stored Apple-FM fallback selection (platform + model id as saved), or
 *  `null` when unset/invalid/itself apple. Pure over the parsed config. */
function fallbackSelectionFrom(config: ConfigFile): { platform: AIPlatform; model: string } | null {
  const raw = config.ai?.fallbackPlatform;
  if (raw === undefined || raw === '') return null;
  const parsed = AIPlatformSchema.safeParse(raw);
  if (!parsed.success || parsed.data === 'apple') return null;
  return { platform: parsed.data, model: config.ai?.fallbackModel ?? getDefaultModel(parsed.data) };
}

/**
 * The saved fallback selection regardless of the current primary platform — for
 * display in settings, so switching the primary in an open dialog doesn't lose
 * the user's fallback choice. `null` when unset/invalid.
 */
export function loadFallbackSelection(): { platform: AIPlatform; model: string } | null {
  return fallbackSelectionFrom(readConfigFile());
}

/** The configured Apple-FM fallback as a resolved `AIConfig` (model remap + key
 *  + base URL), or `null` when none. */
function resolveFallbackConfig(config: ConfigFile): AIConfig | null {
  const sel = fallbackSelectionFrom(config);
  return sel === null ? null : resolvePlatformConfig(sel.platform, sel.model);
}

export function saveAIConfigPreferences(
  platform: AIPlatform,
  model: string,
  opts: { localEndpoint?: string; fallbackPlatform?: string; fallbackModel?: string } = {},
): void {
  updateGlobalConfig((config) => {
    const parsed = ConfigFileSchema.safeParse(config);
    const cfg: ConfigFile = parsed.success ? parsed.data : {};
    cfg.ai ??= {};
    cfg.ai.platform = platform;
    cfg.ai.model = model;
    if (opts.localEndpoint !== undefined) {
      const trimmed = opts.localEndpoint.trim();
      cfg.ai.localEndpoint = trimmed === '' ? undefined : trimmed;
    }
    // Persist the Apple-FM fallback selection. An empty platform clears it.
    if (opts.fallbackPlatform !== undefined) {
      const fp = opts.fallbackPlatform.trim();
      const fm = opts.fallbackModel?.trim();
      cfg.ai.fallbackPlatform = fp === '' ? undefined : fp;
      cfg.ai.fallbackModel = (fp === '' || fm === undefined || fm === '') ? undefined : fm;
    }
    return cfg;
  });
}

export function loadGuidedReviewConfig(): GuidedReviewConfig {
  const config = readConfigFile();
  return {
    enabled: config.guidedReview?.enabled ?? false,
    topics: config.guidedReview?.topics ?? [],
  };
}

export function saveGuidedReviewConfig(settings: GuidedReviewConfig): void {
  updateGlobalConfig((config) => {
    const parsed = ConfigFileSchema.safeParse(config);
    const cfg: ConfigFile = parsed.success ? parsed.data : {};
    cfg.guidedReview = { enabled: settings.enabled, topics: settings.topics };
    return cfg;
  });
}

// Re-exports for backward compatibility — existing importers continue to work
export { deleteAPIKey, detectAvailablePlatforms, getKeychainLabel,isKeychainAvailable, resolveAPIKey, saveAPIKey } from './api-keys.js';
