import { Hono } from 'hono';

import { readGlobalConfig, updateGlobalConfig } from '../../global-config.js';
import type { AppEnv } from '../../types.js';

export const sharePromptRoutes = new Hono<AppEnv>();

sharePromptRoutes.get('/share-prompt/state', (c) => {
  const config = readGlobalConfig();
  const sp = config.sharePrompt as Record<string, unknown> | undefined;
  const dismissedAt = sp !== undefined && typeof sp.dismissedAt === 'number' ? sp.dismissedAt : null;
  const totalOpenMs = sp !== undefined && typeof sp.totalOpenMs === 'number' ? sp.totalOpenMs : 0;
  return c.json({ dismissedAt, totalOpenMs });
});

sharePromptRoutes.post('/share-prompt/dismiss', (c) => {
  updateGlobalConfig((config) => {
    if (config.sharePrompt === undefined) config.sharePrompt = {};
    (config.sharePrompt as Record<string, unknown>).dismissedAt = Date.now();
  });
  return c.json({ ok: true });
});

sharePromptRoutes.post('/share-prompt/tick', async (c) => {
  const body = await c.req.json<{ sessionMs: number }>();
  let totalOpenMs = 0;
  updateGlobalConfig((config) => {
    if (config.sharePrompt === undefined) config.sharePrompt = {};
    const sp = config.sharePrompt as Record<string, unknown>;
    const current = typeof sp.totalOpenMs === 'number' ? sp.totalOpenMs : 0;
    const next = current + (body.sessionMs > 0 ? body.sessionMs : 0);
    sp.totalOpenMs = next;
    totalOpenMs = next;
  });
  return c.json({ totalOpenMs });
});
