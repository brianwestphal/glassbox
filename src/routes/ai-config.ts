import { Hono } from 'hono';

import { isAppleFoundationAvailable } from '../ai/apple-foundation.js';
import {
  deleteAPIKey,
  detectAvailablePlatforms,
  getKeychainLabel,
  isKeychainAvailable,
  loadAIConfig,
  loadFallbackSelection,
  loadGuidedReviewConfig,
  resolveAPIKey,
  resolveLocalEndpoint,
  saveAIConfigPreferences,
  saveAPIKey,
  saveGuidedReviewConfig,
} from '../ai/config.js';
import { fetchAvailableModels } from '../ai/list-models.js';
import type { AIModel, AIPlatform } from '../ai/models.js';
import { AIPlatformSchema, APPLE_FM_ANALYSIS_ENABLED, MODELS, PLATFORMS } from '../ai/models.js';
import type { AIKeyStatusEntry, GetAIKeyStatusResp } from '../api/index.js';
import { SaveAIConfigReqSchema, SaveAIKeyReqSchema } from '../api/index.js';
import { getDemoMode, isAIServiceTest } from '../debug.js';
import type { AppEnv } from '../types.js';
import { errorResponse, parseBody } from '../utils/parseBody.js';

export const aiConfigRoutes = new Hono<AppEnv>();

aiConfigRoutes.get('/config', async (c) => {
  const config = loadAIConfig();
  // Keyless platforms count as "configured" without an API key: `local` as soon
  // as its (defaulted) endpoint is set, `apple` when the on-device helper probe
  // passes (macOS 26 + Apple Intelligence).
  const appleReady = APPLE_FM_ANALYSIS_ENABLED && config.platform === 'apple' && await isAppleFoundationAvailable();
  const fallbackSelection = loadFallbackSelection();
  return c.json({
    platform: config.platform,
    model: config.model,
    keyConfigured: config.apiKey !== null || config.platform === 'local' || appleReady || isAIServiceTest() || getDemoMode() !== null,
    keySource: config.keySource,
    localEndpoint: resolveLocalEndpoint(),
    guidedReview: loadGuidedReviewConfig(),
    // Apple-FM fallback selection as stored, regardless of the current primary
    // platform, so the settings dialog can show/preserve it; `null` when unset.
    fallbackPlatform: fallbackSelection?.platform ?? null,
    fallbackModel: fallbackSelection?.model ?? null,
  });
});

aiConfigRoutes.post('/config', async (c) => {
  const parsed = await parseBody(c, SaveAIConfigReqSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  saveAIConfigPreferences(body.platform, body.model, {
    localEndpoint: body.localEndpoint,
    fallbackPlatform: body.fallbackPlatform,
    fallbackModel: body.fallbackModel,
  });
  if (body.guidedReview !== undefined) {
    saveGuidedReviewConfig(body.guidedReview);
  }
  return c.json({ ok: true } as const);
});

aiConfigRoutes.get('/models', async (c) => {
  // Discover the live model list per platform when a key is configured, so the
  // dropdown reflects what the provider currently offers rather than a static
  // list that goes stale on retirement (GB-894). Falls back to the static
  // `MODELS` list per platform on no-key / failure. Skipped under
  // `--ai-service-test` so the e2e suite stays hermetic (no outbound calls).
  const platforms: AIPlatform[] = ['anthropic', 'openai', 'google'];
  const models = {
    anthropic: MODELS.anthropic, openai: MODELS.openai, google: MODELS.google, local: MODELS.local, apple: MODELS.apple,
  } as Record<AIPlatform, AIModel[]>;
  if (!isAIServiceTest() && getDemoMode() === null) {
    await Promise.all(platforms.map(async (platform) => {
      const { key } = resolveAPIKey(platform);
      if (key === null) return;
      const live = await fetchAvailableModels(platform, key);
      if (live !== null && live.length > 0) models[platform] = live;
    }));
    // Local discovery runs against the configured endpoint regardless of key
    // (Ollama needs none); a reachable server's installed models replace the
    // static fallback.
    const { key: localKey } = resolveAPIKey('local');
    const localLive = await fetchAvailableModels('local', localKey ?? '', { baseUrl: resolveLocalEndpoint() });
    if (localLive !== null && localLive.length > 0) models.local = localLive;
  }
  // Apple Foundation Models are on-device and macOS-26-only. The records carry
  // every platform key (the enum-keyed record schema is exhaustive), so the
  // picker is gated by the `appleAvailable` flag instead of by omitting the key
  // — the settings UI shows the Apple button only when this is true. It's
  // currently force-disabled (`APPLE_FM_ANALYSIS_ENABLED`): the on-device
  // model's 4096-token window can't fit the analysis prompt + output, so even a
  // passing helper probe must not offer it. The probe is short-circuited away.
  const appleAvailable = APPLE_FM_ANALYSIS_ENABLED && await isAppleFoundationAvailable();
  return c.json({ platforms: PLATFORMS, models, appleAvailable });
});

aiConfigRoutes.get('/key-status', (c) => {
  // `apple` is included so the settings UI can index `status['apple']`; it's
  // keyless, so it always reports unconfigured (availability comes from the
  // helper probe surfaced via `/models`, not from a key).
  const platforms: AIPlatform[] = ['anthropic', 'openai', 'google', 'local', 'apple'];
  const status = {} as GetAIKeyStatusResp['status'];
  for (const platform of platforms) {
    const { source } = resolveAPIKey(platform);
    const entry: AIKeyStatusEntry = { configured: source !== null, source };
    status[platform] = entry;
  }
  return c.json({
    status,
    keychainAvailable: isKeychainAvailable(),
    keychainLabel: getKeychainLabel(),
    availablePlatforms: detectAvailablePlatforms(),
  });
});

aiConfigRoutes.post('/key', async (c) => {
  const parsed = await parseBody(c, SaveAIKeyReqSchema);
  if (!parsed.ok) return parsed.response;

  saveAPIKey(parsed.data.platform, parsed.data.key, parsed.data.storage);
  return c.json({ ok: true } as const);
});

aiConfigRoutes.delete('/key', (c) => {
  const platform = c.req.query('platform') ?? 'anthropic';
  const parsed = AIPlatformSchema.safeParse(platform);
  if (!parsed.success) {
    return errorResponse(c, `platform must be one of: ${Object.keys(PLATFORMS).join(', ')}`);
  }
  deleteAPIKey(parsed.data);
  return c.json({ ok: true } as const);
});
