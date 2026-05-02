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
import { MODELS, PLATFORMS } from '../ai/models.js';
import { getDemoMode, isAIServiceTest } from '../debug.js';
import type { AppEnv } from '../types.js';
import { checkEnum } from '../utils/validate.js';

export const aiConfigRoutes = new Hono<AppEnv>();

const VALID_PLATFORMS = ['anthropic', 'openai', 'google'] as const;
const VALID_KEY_STORAGES = ['keychain', 'config'] as const;

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

  const platformCheck = checkEnum(body.platform, 'platform', VALID_PLATFORMS);
  if ('error' in platformCheck) return c.json({ error: platformCheck.error }, 400);
  if (typeof body.model !== 'string' || body.model.trim() === '') {
    return c.json({ error: 'model must be a non-empty string' }, 400);
  }
  if (body.guidedReview !== undefined) {
    const gr: unknown = body.guidedReview;
    if (typeof gr !== 'object' || gr === null || Array.isArray(gr)) {
      return c.json({ error: 'guidedReview must be an object' }, 400);
    }
    const grObj = gr as Record<string, unknown>;
    if (typeof grObj.enabled !== 'boolean') {
      return c.json({ error: 'guidedReview.enabled must be a boolean' }, 400);
    }
    if (!Array.isArray(grObj.topics) || !grObj.topics.every(t => typeof t === 'string')) {
      return c.json({ error: 'guidedReview.topics must be an array of strings' }, 400);
    }
  }

  saveAIConfigPreferences(platformCheck.ok as AIPlatform, body.model);
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

  const platformCheck = checkEnum(body.platform, 'platform', VALID_PLATFORMS);
  if ('error' in platformCheck) return c.json({ error: platformCheck.error }, 400);
  if (typeof body.key !== 'string' || body.key.trim() === '') {
    return c.json({ error: 'key must be a non-empty string' }, 400);
  }
  const storageCheck = checkEnum(body.storage, 'storage', VALID_KEY_STORAGES);
  if ('error' in storageCheck) return c.json({ error: storageCheck.error }, 400);

  saveAPIKey(
    platformCheck.ok as AIPlatform,
    body.key,
    storageCheck.ok,
  );
  return c.json({ ok: true });
});

aiConfigRoutes.delete('/key', (c) => {
  const platform = c.req.query('platform') ?? 'anthropic';
  const platformCheck = checkEnum(platform, 'platform', VALID_PLATFORMS);
  if ('error' in platformCheck) return c.json({ error: platformCheck.error }, 400);
  deleteAPIKey(platformCheck.ok as AIPlatform);
  return c.json({ ok: true });
});
