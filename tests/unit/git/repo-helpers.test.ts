/**
 * Unit tests for the repo helpers in src/git/repo.ts: getRepoRoot / getRepoName
 * / isGitRepo / getHeadCommit. The `scrubbedGitEnv` re-export is exercised
 * separately in repo.test.ts. These mock the shared `git()` spawn helper and
 * `child_process.spawnSync` so no real git process runs, and assert the exact
 * argv each helper passes plus the parsing of stdout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gitMock = vi.fn<(args: string[], cwd: string) => string>();
const scrubbedGitEnvMock = vi.fn(() => ({ SCRUBBED: '1' }));
vi.mock('../../../src/git/spawn.js', () => ({
  git: (args: string[], cwd: string) => gitMock(args, cwd),
  scrubbedGitEnv: () => scrubbedGitEnvMock(),
}));

const spawnSyncMock = vi.fn();
vi.mock('child_process', () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

const { getRepoRoot, getRepoName, isGitRepo, getHeadCommit, getCommitInfo } = await import('../../../src/git/repo.js');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getRepoRoot', () => {
  it('runs rev-parse --show-toplevel and trims the result', () => {
    gitMock.mockReturnValue('/Users/me/project\n');
    expect(getRepoRoot('/Users/me/project/src')).toBe('/Users/me/project');
    expect(gitMock).toHaveBeenCalledWith(['rev-parse', '--show-toplevel'], '/Users/me/project/src');
  });
});

describe('getRepoName', () => {
  it('returns the basename of the repo root', () => {
    gitMock.mockReturnValue('/Users/me/my-cool-repo\n');
    expect(getRepoName('/anywhere')).toBe('my-cool-repo');
  });

  it('takes the last path segment for a nested root', () => {
    gitMock.mockReturnValue('/Users/me/a/b/c\n');
    expect(getRepoName('/anywhere')).toBe('c');
  });
});

describe('isGitRepo', () => {
  it('returns true when rev-parse succeeds', () => {
    gitMock.mockReturnValue('true\n');
    expect(isGitRepo('/some/repo')).toBe(true);
    expect(gitMock).toHaveBeenCalledWith(['rev-parse', '--is-inside-work-tree'], '/some/repo');
  });

  it('returns false when the git call throws (not a repo)', () => {
    gitMock.mockImplementation(() => { throw new Error('not a git repository'); });
    expect(isGitRepo('/tmp/plain')).toBe(false);
  });
});

describe('getHeadCommit', () => {
  it('runs git rev-parse HEAD with the scrubbed env and trims stdout', () => {
    spawnSyncMock.mockReturnValue({ stdout: 'deadbeef1234\n', status: 0 });

    const sha = getHeadCommit('/some/repo');

    expect(sha).toBe('deadbeef1234');
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'git',
      ['rev-parse', 'HEAD'],
      expect.objectContaining({ cwd: '/some/repo', encoding: 'utf-8', env: { SCRUBBED: '1' } }),
    );
  });
});

describe('getCommitInfo (GB-1142)', () => {
  it('parses the NUL-separated %h/%s/%B format into shortSha/subject/message', () => {
    spawnSyncMock.mockReturnValue({ stdout: 'a1b2c3d\x00Fix the thing\x00Fix the thing\n\nLonger body here.\n', status: 0 });

    const info = getCommitInfo('/repo', 'a1b2c3ddeadbeef');

    expect(info).toEqual({ shortSha: 'a1b2c3d', subject: 'Fix the thing', message: 'Fix the thing\n\nLonger body here.' });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'git',
      ['show', '-s', '--format=%h%x00%s%x00%B', 'a1b2c3ddeadbeef'],
      expect.objectContaining({ cwd: '/repo', encoding: 'utf-8', env: { SCRUBBED: '1' } }),
    );
  });

  it('returns null when git fails (unknown/synthetic sha)', () => {
    spawnSyncMock.mockReturnValue({ stdout: '', status: 128 });
    expect(getCommitInfo('/repo', 'nope')).toBeNull();
  });

  it('returns null when stdout is malformed (missing separators)', () => {
    spawnSyncMock.mockReturnValue({ stdout: 'just-a-hash\n', status: 0 });
    expect(getCommitInfo('/repo', 'x')).toBeNull();
  });
});
