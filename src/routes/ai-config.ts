import { Hono } from 'hono';

import {
  deleteAPIKey,
  detectAvailablePlatforms,
  getKeychainLabel,
  isKeychainAvailable,
  loadAIConfig,
  loadGuidedReviewConfig,
  resolveAPIKey,
  resolveLocalEndpoint,
  saveAIConfigPreferences,
  saveAPIKey,
  saveGuidedReviewConfig,
} from '../ai/config.js';
import { fetchAvailableModels } from '../ai/list-models.js';
import type { AIModel, AIPlatform } from '../ai/models.js';
import { AIPlatformSchema, MODELS, PLATFORMS } from '../ai/models.js';
import type { AIKeyStatusEntry, GetAIKeyStatusResp } from '../api/index.js';
import { SaveAIConfigReqSchema, SaveAIKeyReqSchema } from '../api/index.js';
import { getDemoMode, isAIServiceTest } from '../debug.js';
import type { AppEnv } from '../types.js';
import { errorResponse, parseBody } from '../utils/parseBody.js';

export const aiConfigRoutes = new Hono<AppEnv>();

aiConfigRoutes.get('/config', (c) => {
  const config = loadAIConfig();
  return c.json({
    platform: config.platform,
    model: config.model,
    // `local` is keyless — usable as soon as its (defaulted) endpoint is set,
    // so it counts as "configured" without an API key.
    keyConfigured: config.apiKey !== null || config.platform === 'local' || isAIServiceTest() || getDemoMode() !== null,
    keySource: config.keySource,
    localEndpoint: resolveLocalEndpoint(),
    guidedReview: loadGuidedReviewConfig(),
  });
});

aiConfigRoutes.post('/config', async (c) => {
  const parsed = await parseBody(c, SaveAIConfigReqSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  saveAIConfigPreferences(body.platform, body.model, { localEndpoint: body.localEndpoint });
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
    anthropic: MODELS.anthropic, openai: MODELS.openai, google: MODELS.google, local: MODELS.local,
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
  return c.json({ platforms: PLATFORMS, models });
});

aiConfigRoutes.get('/key-status', (c) => {
  const platforms: AIPlatform[] = ['anthropic', 'openai', 'google', 'local'];
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
