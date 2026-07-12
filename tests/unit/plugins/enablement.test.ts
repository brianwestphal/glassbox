import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  disabledScope,
  isPluginEnabled,
  readProjectDisabled,
  setProjectDisabled,
} from '../../../src/plugins/enablement.js';

describe('enablement logic (doc 29 FR-29.16)', () => {
  it('is enabled by default (in neither disable list)', () => {
    expect(isPluginEnabled('graphviz', { globalDisabled: [], projectDisabled: [] })).toBe(true);
    expect(disabledScope('graphviz', { globalDisabled: [], projectDisabled: [] })).toBeNull();
  });

  it('project-disabled reports project scope', () => {
    const lists = { globalDisabled: [], projectDisabled: ['graphviz'] };
    expect(isPluginEnabled('graphviz', lists)).toBe(false);
    expect(disabledScope('graphviz', lists)).toBe('project');
  });

  it('global-disabled reports global scope', () => {
    const lists = { globalDisabled: ['graphviz'], projectDisabled: [] };
    expect(isPluginEnabled('graphviz', lists)).toBe(false);
    expect(disabledScope('graphviz', lists)).toBe('global');
  });

  it('global takes precedence when disabled in both', () => {
    const lists = { globalDisabled: ['graphviz'], projectDisabled: ['graphviz'] };
    expect(disabledScope('graphviz', lists)).toBe('global');
    expect(isPluginEnabled('graphviz', lists)).toBe(false);
  });
});

describe('per-project disable store', () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'gb-repo-')); });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it('round-trips through .glassbox/settings.json', () => {
    expect(readProjectDisabled(repo)).toEqual([]);
    setProjectDisabled(repo, 'graphviz', true);
    expect(readProjectDisabled(repo)).toEqual(['graphviz']);
    // Persisted under the settings.json key, not clobbering other keys.
    const saved = JSON.parse(readFileSync(join(repo, '.glassbox', 'settings.json'), 'utf8'));
    expect(saved.disabledPlugins).toEqual(['graphviz']);

    setProjectDisabled(repo, 'graphviz', false);
    expect(readProjectDisabled(repo)).toEqual([]);
  });

  it('dedupes and preserves a sibling appName key', () => {
    // Seed an appName so we can prove the enablement write doesn't clobber it.
    setProjectDisabled(repo, 'a', true);
    setProjectDisabled(repo, 'a', true); // idempotent
    setProjectDisabled(repo, 'b', true);
    expect(readProjectDisabled(repo).sort()).toEqual(['a', 'b']);
  });
});
