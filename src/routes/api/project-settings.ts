import { Hono } from 'hono';

import { UpdateProjectSettingsReqSchema } from '../../api/project-settings.js';
import { readProjectSettings, updateProjectSettings } from '../../project-settings-store.js';
import type { AppEnv } from '../../types.js';
import { parseBody } from '../../utils/parseBody.js';

export const projectSettingsRoutes = new Hono<AppEnv>();

projectSettingsRoutes.get('/project-settings', (c) => {
  return c.json(readProjectSettings(c.get('repoRoot')));
});

projectSettingsRoutes.patch('/project-settings', async (c) => {
  const repoRoot = c.get('repoRoot');
  const parsed = await parseBody(c, UpdateProjectSettingsReqSchema);
  if (!parsed.ok) return parsed.response;

  updateProjectSettings(repoRoot, (s) => {
    if (parsed.data.appName !== undefined) s.appName = parsed.data.appName || undefined;
  });
  return c.json(readProjectSettings(repoRoot));
});
