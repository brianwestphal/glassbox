import { Hono } from 'hono';
import { z } from 'zod';

import { TickSharePromptReqSchema } from '../../api/share-prompt.js';
import { readGlobalConfig, updateGlobalConfig } from '../../global-config.js';
import type { AppEnv } from '../../types.js';
import { parseBody } from '../../utils/parseBody.js';

export const sharePromptRoutes = new Hono<AppEnv>();

const SharePromptShapeSchema = z.object({
  dismissedAt: z.number().nullable().optional(),
  totalOpenMs: z.number().optional(),
});

sharePromptRoutes.get('/share-prompt/state', (c) => {
  const config = readGlobalConfig();
  const sp = SharePromptShapeSchema.safeParse(config.sharePrompt);
  const data = sp.success ? sp.data : {};
  return c.json({
    dismissedAt: data.dismissedAt ?? null,
    totalOpenMs: data.totalOpenMs ?? 0,
  });
});

sharePromptRoutes.post('/share-prompt/dismiss', (c) => {
  updateGlobalConfig((config) => {
    const current = SharePromptShapeSchema.safeParse(config.sharePrompt);
    const base = current.success ? current.data : {};
    config.sharePrompt = { ...base, dismissedAt: Date.now() };
  });
  return c.json({ ok: true } as const);
});

sharePromptRoutes.post('/share-prompt/tick', async (c) => {
  const parsed = await parseBody(c, TickSharePromptReqSchema);
  if (!parsed.ok) return parsed.response;
  const sessionMs = parsed.data.sessionMs;
  let totalOpenMs = 0;
  updateGlobalConfig((config) => {
    const current = SharePromptShapeSchema.safeParse(config.sharePrompt);
    const base = current.success ? current.data : {};
    const previousTotal = base.totalOpenMs ?? 0;
    const next = previousTotal + (sessionMs > 0 ? sessionMs : 0);
    config.sharePrompt = { ...base, totalOpenMs: next };
    totalOpenMs = next;
  });
  return c.json({ totalOpenMs });
});
