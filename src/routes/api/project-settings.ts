import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { Hono } from 'hono';
import { join } from 'path';

import type { ProjectSettings } from '../../api/project-settings.js';
import { ProjectSettingsSchema, UpdateProjectSettingsReqSchema } from '../../api/project-settings.js';
import type { AppEnv } from '../../types.js';
import { parseBody } from '../../utils/parseBody.js';

export const projectSettingsRoutes = new Hono<AppEnv>();

function readProjectSettings(repoRoot: string): ProjectSettings {
  const settingsPath = join(repoRoot, '.glassbox', 'settings.json');
  try {
    if (existsSync(settingsPath)) {
      const raw: unknown = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      const parsed = ProjectSettingsSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }
  } catch { /* corrupt or missing */ }
  return {};
}

function writeProjectSettings(repoRoot: string, settings: ProjectSettings): void {
  const dir = join(repoRoot, '.glassbox');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8');
}

projectSettingsRoutes.get('/project-settings', (c) => {
  const repoRoot = c.get('repoRoot');
  return c.json(readProjectSettings(repoRoot));
});

projectSettingsRoutes.patch('/project-settings', async (c) => {
  const repoRoot = c.get('repoRoot');
  const parsed = await parseBody(c, UpdateProjectSettingsReqSchema);
  if (!parsed.ok) return parsed.response;

  const current = readProjectSettings(repoRoot);
  if (parsed.data.appName !== undefined) current.appName = parsed.data.appName || undefined;
  writeProjectSettings(repoRoot, current);
  return c.json(current);
});
