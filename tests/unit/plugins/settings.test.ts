import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PluginManifest } from '../../../src/plugins/manifest.js';
import { parseManifest } from '../../../src/plugins/manifest.js';
import { readPluginPreferenceValues, readPluginSetting, writePluginSetting } from '../../../src/plugins/settings.js';

const manifest: PluginManifest = parseManifest({
  id: 'settings-test-plugin',
  name: 'Settings Test',
  version: '1.0.0',
  preferences: [
    { key: 'engine', label: 'Engine', type: 'select', default: 'dot', options: ['dot', 'neato'] },
    { key: 'theme', label: 'Theme', type: 'string', scope: 'project' },
  ],
}) as PluginManifest;

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'gb-prefrepo-')); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe('manifest preferences (doc 29 FR-29.12)', () => {
  it('parses a preferences array', () => {
    expect(manifest.preferences).toHaveLength(2);
    expect(manifest.preferences?.[0]).toMatchObject({ key: 'engine', type: 'select', default: 'dot' });
    expect(manifest.preferences?.[1]).toMatchObject({ key: 'theme', scope: 'project' });
  });
});

describe('plugin settings store (doc 29 FR-29.12)', () => {
  it('falls back to the declared default when unset', () => {
    // A global-scope pref with no stored value resolves to its default (read-only).
    expect(readPluginSetting(manifest, repo, 'engine')).toBe('dot');
    // No default + unset -> null.
    expect(readPluginSetting(manifest, repo, 'theme')).toBeNull();
  });

  it('round-trips a project-scoped preference through .glassbox/settings.json', () => {
    writePluginSetting(manifest, repo, 'theme', 'dark');
    expect(readPluginSetting(manifest, repo, 'theme')).toBe('dark');
    const saved = JSON.parse(readFileSync(join(repo, '.glassbox', 'settings.json'), 'utf8'));
    expect(saved.pluginSettings['settings-test-plugin'].theme).toBe('dark');
  });

  it('readPluginPreferenceValues returns every declared pref (stored or default)', () => {
    writePluginSetting(manifest, repo, 'theme', 'light');
    const values = readPluginPreferenceValues(manifest, repo);
    expect(values.engine).toBe('dot'); // default
    expect(values.theme).toBe('light'); // stored (project)
  });
});
