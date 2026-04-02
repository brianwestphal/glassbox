import { Hono } from 'hono';

import type { AIPlatform } from '../ai/models.js';
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
import { MODELS, PLATFORMS } from '../ai/models.js';
import { getDemoMode, isAIServiceTest } from '../debug.js';
import type { AppEnv } from '../types.js';

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
  const body = await c.req.json<{
    platform: string;
    model: string;
    guidedReview?: { enabled: boolean; topics: string[] };
  }>();
  saveAIConfigPreferences(body.platform as AIPlatform, body.model);
  if (body.guidedReview !== undefined) {
    saveGuidedReviewConfig(body.guidedReview);
  }
  return c.json({ ok: true });
});

aiConfigRoutes.get('/models', (c) => {
  return c.json({
    platforms: PLATFORMS,
    models: MODELS,
  });
});

aiConfigRoutes.get('/key-status', (c) => {
  const platforms = (['anthropic', 'openai', 'google'] as AIPlatform[]);
  const status: Record<string, { configured: boolean; source: string | null }> = {};
  for (const platform of platforms) {
    const { source } = resolveAPIKey(platform);
    status[platform] = { configured: source !== null, source };
  }
  return c.json({
    status,
    keychainAvailable: isKeychainAvailable(),
    keychainLabel: getKeychainLabel(),
    availablePlatforms: detectAvailablePlatforms(),
  });
});

aiConfigRoutes.post('/key', async (c) => {
  const body = await c.req.json<{ platform: string; key: string; storage: string }>();
  saveAPIKey(
    body.platform as AIPlatform,
    body.key,
    body.storage as 'keychain' | 'config',
  );
  return c.json({ ok: true });
});

aiConfigRoutes.delete('/key', (c) => {
  const platform = c.req.query('platform') ?? 'anthropic';
  deleteAPIKey(platform as AIPlatform);
  return c.json({ ok: true });
});
