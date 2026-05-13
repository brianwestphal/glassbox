import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { Hono } from 'hono';
import { join } from 'path';

import type { AppEnv } from '../../types.js';

export const projectSettingsRoutes = new Hono<AppEnv>();

interface ProjectSettings {
  appName?: string;
}

function readProjectSettings(repoRoot: string): ProjectSettings {
  const settingsPath = join(repoRoot, '.glassbox', 'settings.json');
  try {
    if (existsSync(settingsPath)) {
      return JSON.parse(readFileSync(settingsPath, 'utf-8')) as ProjectSettings;
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
  const raw = await c.req.json<unknown>();
  if (typeof raw !== 'object' || raw === null) {
    return c.json({ error: 'body must be a JSON object' }, 400);
  }
  const body = raw as Partial<ProjectSettings>;

  if (body.appName !== undefined && typeof body.appName !== 'string') {
    return c.json({ error: 'appName must be a string' }, 400);
  }

  const current = readProjectSettings(repoRoot);
  if (body.appName !== undefined) current.appName = body.appName || undefined;
  writeProjectSettings(repoRoot, current);
  return c.json(current);
});
