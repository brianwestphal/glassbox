import { Hono } from 'hono';

import { RegisterDifftoolReqSchema } from '../api/index.js';
import { getDifftoolStatus, registerDifftool, unregisterDifftool } from '../git/difftool.js';
import type { AppEnv } from '../types.js';
import { parseBody } from '../utils/parseBody.js';

/**
 * GB-850 — settings-dialog API for the `git difftool` registration. Mirrors
 * the CLI `--register-difftool` / `--unregister-difftool` flags. Always
 * operates at `--global` scope (the settings dialog is "what affects every
 * repo I use"); the per-repo `--local` flag stays CLI-only.
 */
export const difftoolApiRoutes = new Hono<AppEnv>();

/** GET /difftool/status — current `diff.tool` + cmd + glassbox-match flag. */
difftoolApiRoutes.get('/status', (c) => {
  return c.json(getDifftoolStatus('global'));
});

// POST /difftool/register — body: { force?: boolean }.
difftoolApiRoutes.post('/register', async (c) => {
  const parsed = await parseBody(c, RegisterDifftoolReqSchema);
  if (!parsed.ok) return parsed.response;
  return c.json(registerDifftool({ scope: 'global', force: parsed.data.force === true }));
});

/** POST /difftool/unregister — no body. */
difftoolApiRoutes.post('/unregister', (c) => {
  return c.json(unregisterDifftool({ scope: 'global' }));
});
