import { Hono } from 'hono';

import { OpenExternalReqSchema } from '../../api/system.js';
import type { AppEnv } from '../../types.js';
import { openOS } from '../../utils/openOS.js';
import { parseBody } from '../../utils/parseBody.js';

export const systemRoutes = new Hono<AppEnv>();

// Open a URL in the OS default browser. Used by the client when running inside
// the Tauri shell, where an anchor's `target="_blank"` can't open a browser.
// `openOS` uses `execFileSync` (argv, no shell) so the validated http(s) URL is
// passed without shell interpolation.
systemRoutes.post('/open-external', async (c) => {
  const parsed = await parseBody(c, OpenExternalReqSchema);
  if (!parsed.ok) return parsed.response;

  try {
    openOS(parsed.data.url, 'url');
  } catch { /* best-effort: if the OS open fails the link just doesn't open */ }
  return c.json({ ok: true } as const);
});
