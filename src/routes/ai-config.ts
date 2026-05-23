import { Hono } from 'hono';

import {
  deleteAPIKey,
  detectAvailablePlatforms,
  getKeychainLabel,
  isKeychainAvailable,
  loadAIConfig,
  loadGuidedReviewConfig,
  resolveAPIKey,
  saveAIConfigPreferences,
  saveAPIKey,
  saveGuidedReviewConfig,
} from '../ai/config.js';
import type { AIPlatform } from '../ai/models.js';
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
    keyConfigured: config.apiKey !== null || isAIServiceTest() || getDemoMode() !== null,
    keySource: config.keySource,
    guidedReview: loadGuidedReviewConfig(),
  });
});

aiConfigRoutes.post('/config', async (c) => {
  const parsed = await parseBody(c, SaveAIConfigReqSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  saveAIConfigPreferences(body.platform, body.model);
  if (body.guidedReview !== undefined) {
    saveGuidedReviewConfig(body.guidedReview);
  }
  return c.json({ ok: true } as const);
});

aiConfigRoutes.get('/models', (c) => {
  return c.json({ platforms: PLATFORMS, models: MODELS });
});

aiConfigRoutes.get('/key-status', (c) => {
  const platforms: AIPlatform[] = ['anthropic', 'openai', 'google'];
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
    return errorResponse(c, `platform must be one of: anthropic, openai, google`);
  }
  deleteAPIKey(parsed.data);
  return c.json({ ok: true } as const);
});
