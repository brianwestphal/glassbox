/**
 * Unit tests for src/git/repo.ts — specifically scrubbedGitEnv().
 *
 * scrubbedGitEnv() is the single source of truth for the environment every
 * internal git subprocess runs with. Its whole job is to strip the variables
 * `git difftool` leaks into the tool's environment (GIT_EXTERNAL_DIFF and the
 * per-file GIT_DIFF_PATH_*), which would otherwise make Glassbox's own
 * `git diff` / `git show` re-invoke the difftool helper instead of emitting a
 * patch — runaway recursion and an empty diff ("No changes found"). These tests
 * pin that invariant directly so it can't silently regress regardless of which
 * git call site consumes the helper (doc 19, NFR-19.12).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { scrubbedGitEnv } from '../../../src/git/repo.js';

describe('scrubbedGitEnv', () => {
  const saved = {
    ext: process.env.GIT_EXTERNAL_DIFF,
    counter: process.env.GIT_DIFF_PATH_COUNTER,
    total: process.env.GIT_DIFF_PATH_TOTAL,
  };

  afterEach(() => {
    // Restore whatever the ambient environment was, key by key.
    for (const [key, value] of Object.entries({
      GIT_EXTERNAL_DIFF: saved.ext,
      GIT_DIFF_PATH_COUNTER: saved.counter,
      GIT_DIFF_PATH_TOTAL: saved.total,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('strips the variables git difftool leaks into the tool environment', () => {
    process.env.GIT_EXTERNAL_DIFF = 'git-difftool--helper';
    process.env.GIT_DIFF_PATH_COUNTER = '1';
    process.env.GIT_DIFF_PATH_TOTAL = '3';

    const env = scrubbedGitEnv();

    expect(env.GIT_EXTERNAL_DIFF).toBeUndefined();
    expect(env.GIT_DIFF_PATH_COUNTER).toBeUndefined();
    expect(env.GIT_DIFF_PATH_TOTAL).toBeUndefined();
  });

  it('preserves the rest of the environment (e.g. PATH, HOME)', () => {
    process.env.GIT_EXTERNAL_DIFF = 'git-difftool--helper';

    const env = scrubbedGitEnv();

    // A representative sampling of vars git relies on must survive untouched.
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME).toBe(process.env.HOME);
  });

  it('does not mutate the live process environment', () => {
    process.env.GIT_EXTERNAL_DIFF = 'git-difftool--helper';

    scrubbedGitEnv();

    // The helper returns a scrubbed *copy*; the caller's own environment is
    // unchanged so unrelated process behavior is unaffected.
    expect(process.env.GIT_EXTERNAL_DIFF).toBe('git-difftool--helper');
  });

  it('is a no-op when none of the leaked variables are present', () => {
    delete process.env.GIT_EXTERNAL_DIFF;
    delete process.env.GIT_DIFF_PATH_COUNTER;
    delete process.env.GIT_DIFF_PATH_TOTAL;

    const env = scrubbedGitEnv();

    expect(env.GIT_EXTERNAL_DIFF).toBeUndefined();
    expect(env.GIT_DIFF_PATH_COUNTER).toBeUndefined();
    expect(env.GIT_DIFF_PATH_TOTAL).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
  });
});
