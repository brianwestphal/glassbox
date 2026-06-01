import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import {
  DIFFTOOL_CMD,
  getDifftoolStatus,
  registerDifftool,
  unregisterDifftool,
} from '../../../src/git/difftool.js';

// All tests run against a temp git repo at `--local` scope so they cannot
// touch the developer's real `~/.gitconfig`. The helpers accept an optional
// `cwd` for exactly this reason.

function git(args: string[], cwd: string): { status: number; stdout: string } {
  const r = spawnSync('git', args, { encoding: 'utf-8', cwd });
  return { status: r.status ?? -1, stdout: (r.stdout || '').trim() };
}

function readLocal(key: string, cwd: string): string | null {
  const r = git(['config', '--local', '--get', key], cwd);
  return r.status === 0 ? r.stdout : null;
}

describe('git difftool helpers', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'glassbox-difftool-'));
    spawnSync('git', ['init', '-q'], { cwd: repo });
    spawnSync('git', ['config', '--local', 'user.email', 'test@example.com'], { cwd: repo });
    spawnSync('git', ['config', '--local', 'user.name', 'Test'], { cwd: repo });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  describe('getDifftoolStatus', () => {
    it('returns null tool when nothing is configured', () => {
      const s = getDifftoolStatus('local', repo);
      expect(s.tool).toBeNull();
      expect(s.cmd).toBeNull();
      expect(s.isGlassbox).toBe(false);
    });

    it('reports a non-glassbox tool faithfully', () => {
      git(['config', '--local', 'diff.tool', 'vimdiff'], repo);
      const s = getDifftoolStatus('local', repo);
      expect(s.tool).toBe('vimdiff');
      expect(s.isGlassbox).toBe(false);
    });

    it('flags isGlassbox=true only when tool AND cmd match', () => {
      git(['config', '--local', 'diff.tool', 'glassbox'], repo);
      git(['config', '--local', 'difftool.glassbox.cmd', DIFFTOOL_CMD], repo);
      const s = getDifftoolStatus('local', repo);
      expect(s.isGlassbox).toBe(true);
    });

    it('flags isGlassbox=false when tool=glassbox but cmd is wrong', () => {
      git(['config', '--local', 'diff.tool', 'glassbox'], repo);
      git(['config', '--local', 'difftool.glassbox.cmd', 'something-else'], repo);
      const s = getDifftoolStatus('local', repo);
      expect(s.isGlassbox).toBe(false);
    });
  });

  describe('registerDifftool', () => {
    it('writes the three keys on first registration', () => {
      const res = registerDifftool({ scope: 'local', cwd: repo });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.replacedTool).toBeNull();

      expect(readLocal('diff.tool', repo)).toBe('glassbox');
      expect(readLocal('difftool.glassbox.cmd', repo)).toBe(DIFFTOOL_CMD);
      expect(readLocal('difftool.prompt', repo)).toBe('false');
    });

    it('is a no-op when already correctly registered', () => {
      registerDifftool({ scope: 'local', cwd: repo });
      const res = registerDifftool({ scope: 'local', cwd: repo });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.replacedTool).toBeNull();
    });

    it('refuses to overwrite a non-glassbox tool without force', () => {
      git(['config', '--local', 'diff.tool', 'vimdiff'], repo);
      const res = registerDifftool({ scope: 'local', cwd: repo });
      expect(res.ok).toBe(false);
      if (!res.ok && res.reason === 'conflict') {
        expect(res.currentTool).toBe('vimdiff');
      } else {
        throw new Error('expected conflict result');
      }
      // Did NOT clobber the user's setting.
      expect(readLocal('diff.tool', repo)).toBe('vimdiff');
    });

    it('overwrites a non-glassbox tool with force=true and reports replacedTool', () => {
      git(['config', '--local', 'diff.tool', 'vimdiff'], repo);
      const res = registerDifftool({ scope: 'local', cwd: repo, force: true });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.replacedTool).toBe('vimdiff');
      expect(readLocal('diff.tool', repo)).toBe('glassbox');
    });

    it('returns a descriptive git-failed message when git itself fails (GB-852)', () => {
      // Make `git config --local` fail by removing the .git directory the
      // helper depends on. The helper still finds `git` on PATH but the
      // command exits non-zero with stderr describing the issue. The
      // returned message must include the failing key + stderr so the user
      // can act on it instead of seeing a generic toast.
      rmSync(join(repo, '.git'), { recursive: true, force: true });
      const res = registerDifftool({ scope: 'local', cwd: repo });
      expect(res.ok).toBe(false);
      if (!res.ok && res.reason === 'git-failed') {
        expect(res.message).toContain('git config --local diff.tool');
        // Some git error text — exact wording varies across git versions.
        expect(res.message.length).toBeGreaterThan('git config --local diff.tool'.length + 8);
      } else {
        throw new Error('expected git-failed result, got: ' + JSON.stringify(res));
      }
    });
  });

  describe('unregisterDifftool', () => {
    it('removes the keys we previously set', () => {
      registerDifftool({ scope: 'local', cwd: repo });
      const res = unregisterDifftool({ scope: 'local', cwd: repo });
      expect(res.removed).toBe(true);
      expect(readLocal('diff.tool', repo)).toBeNull();
      expect(readLocal('difftool.glassbox.cmd', repo)).toBeNull();
      expect(readLocal('difftool.prompt', repo)).toBeNull();
    });

    it('leaves a non-glassbox tool untouched', () => {
      git(['config', '--local', 'diff.tool', 'vimdiff'], repo);
      const res = unregisterDifftool({ scope: 'local', cwd: repo });
      expect(res.removed).toBe(false);
      expect(readLocal('diff.tool', repo)).toBe('vimdiff');
    });

    it('is a no-op success when nothing is configured', () => {
      const res = unregisterDifftool({ scope: 'local', cwd: repo });
      expect(res.removed).toBe(false);
    });
  });
});
