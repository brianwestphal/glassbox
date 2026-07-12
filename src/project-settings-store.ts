/**
 * Shared read/modify/write for `.glassbox/settings.json` (per-repo project
 * settings). The single server-side entry point so concurrent writers (the
 * project-settings route for `appName`, the plugin-enablement store for
 * `disabledPlugins`) don't clobber each other's keys — mirrors the
 * `global-config.ts` read-modify-write contract for the global config.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { ProjectSettings } from './api/project-settings.js';
import { ProjectSettingsSchema } from './api/project-settings.js';

function settingsPath(repoRoot: string): string {
  return join(repoRoot, '.glassbox', 'settings.json');
}

export function readProjectSettings(repoRoot: string): ProjectSettings {
  try {
    const path = settingsPath(repoRoot);
    if (existsSync(path)) {
      const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'));
      const parsed = ProjectSettingsSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    }
  } catch { /* corrupt or missing — start fresh */ }
  return {};
}

/**
 * Read-modify-write the project settings under one call. The mutator may return
 * a replacement object or mutate in place and return nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- mutator may return nothing (in-place) or a replacement
export function updateProjectSettings(repoRoot: string, mutator: (s: ProjectSettings) => ProjectSettings | void): void {
  const current = readProjectSettings(repoRoot);
  const result = mutator(current);
  const next = result === undefined ? current : result;
  const dir = join(repoRoot, '.glassbox');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(next, null, 2), 'utf-8');
}
