/**
 * Unit tests for the launcher tail of `src/cli.ts` — the pieces extracted out
 * of `main()` so they are testable in isolation:
 *
 *  - `launchReview` — the reuse / resume / create decision tail of a normal
 *    launch (transition-tested across the existing-review states)
 *  - `resolveGroundTruthLaunch` — manifest load + existence validation +
 *    perceptual scoring (doc 26)
 *  - `runDifftoolServe` — the detached accumulating `git difftool` server
 *    (doc 19), including its shutdown callback
 *
 * All heavy collaborators (DB, HTTP server, git, plugins, perceptual diff) are
 * mocked; assertions pin which collaborator runs on which state, in order.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewMode } from '../../../src/git/types.js';

const dbQueries = vi.hoisted(() => ({
  addReviewFile: vi.fn(),
  createReview: vi.fn(),
  getLatestInProgressReview: vi.fn(),
}));
vi.mock('../../../src/db/queries.js', () => dbQueries);

const setDataDir = vi.hoisted(() => vi.fn());
vi.mock('../../../src/db/connection.js', () => ({ setDataDir }));

vi.mock('../../../src/debug.js', () => ({
  setDebug: vi.fn(),
  setAIServiceTest: vi.fn(),
  setDemoMode: vi.fn(),
}));
vi.mock('../../../src/demo.js', () => ({
  DEMO_SCENARIOS: [{ id: 1, label: 'Demo One' }],
  setupDemoReview: vi.fn(),
}));

const gitDiff = vi.hoisted(() => ({
  getFileDiffs: vi.fn(),
  getHeadCommit: vi.fn(),
  getModeArgs: vi.fn(() => ''),
  getModeString: vi.fn(() => 'uncommitted'),
  getRepoName: vi.fn(),
  getRepoRoot: vi.fn(),
  isGitRepo: vi.fn(),
}));
vi.mock('../../../src/git/diff.js', () => gitDiff);

const ensureGlassboxGitignored = vi.hoisted(() => vi.fn(() => ({ changed: false })));
vi.mock('../../../src/git/gitignore.js', () => ({ ensureGlassboxGitignored }));

vi.mock('../../../src/lock.js', () => ({ acquireLock: vi.fn() }));

const updateReviewDiffs = vi.hoisted(() => vi.fn());
vi.mock('../../../src/review-update.js', () => ({ updateReviewDiffs }));

const startServer = vi.hoisted(() => vi.fn());
vi.mock('../../../src/server.js', () => ({ startServer }));

vi.mock('../../../src/skills.js', () => ({ ensureSkills: vi.fn(() => []) }));
vi.mock('../../../src/update-check.js', () => ({ checkForUpdates: vi.fn() }));
vi.mock('../../../src/cli-subcommands.js', () => ({
  handleDifftoolRegistration: vi.fn(),
  handleGroundTruthPromote: vi.fn(),
  handleNoteSubcommand: vi.fn(),
}));

// Dynamically imported collaborators
const initDifftoolSession = vi.hoisted(() => vi.fn());
vi.mock('../../../src/difftool/session.js', () => ({ initDifftoolSession }));

const discovery = vi.hoisted(() => ({
  writeDiscovery: vi.fn(),
  clearDiscovery: vi.fn(),
  releaseStartingLock: vi.fn(),
}));
vi.mock('../../../src/git/difftool-discovery.js', () => discovery);

const clearImageBlobs = vi.hoisted(() => vi.fn());
vi.mock('../../../src/git/image-blobs.js', () => ({ clearImageBlobs }));

const loadGroundTruthManifest = vi.hoisted(() => vi.fn());
vi.mock('../../../src/ground-truth/manifest.js', () => ({ loadGroundTruthManifest }));

const initContentPlugins = vi.hoisted(() => vi.fn());
vi.mock('../../../src/plugins/index.js', () => ({ initContentPlugins }));

const comparePerceptual = vi.hoisted(() => vi.fn());
vi.mock('../../../src/ground-truth/perceptual-diff.js', () => ({ comparePerceptual }));

import { launchReview, main, resolveGroundTruthLaunch, runDifftoolServe } from '../../../src/cli.js';
import { handleDifftoolRegistration, handleNoteSubcommand } from '../../../src/cli-subcommands.js';
import { setDemoMode } from '../../../src/debug.js';
import { setupDemoReview } from '../../../src/demo.js';
import { acquireLock } from '../../../src/lock.js';
import { ensureSkills } from '../../../src/skills.js';

class ExitSentinel extends Error {
  constructor(public code: number) { super(`process.exit(${String(code)})`); }
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitSentinel(code ?? 0);
  }) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  startServer.mockResolvedValue({ port: 4183, server: { close: vi.fn() } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function logged(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
}

const baseLaunch = {
  mode: { type: 'uncommitted' } as ReviewMode,
  cwd: '/repo',
  repoRoot: '/repo',
  repoName: 'repo',
  headCommit: 'abc123',
  groundTruthScores: new Map<string, number | null>(),
  port: 4183,
  resume: false,
  noOpen: true,
  strictPort: false,
  onComplete: null,
};

describe('launchReview', () => {
  it('reuses an in-progress review at the same HEAD: updates diffs, never creates', async () => {
    dbQueries.getLatestInProgressReview.mockResolvedValue({ id: 'rev-1', head_commit: 'abc123', created_at: 'now' });
    gitDiff.getFileDiffs.mockReturnValue([{ filePath: 'a.ts' }]);
    updateReviewDiffs.mockResolvedValue({ updated: 1, added: 0, stale: 2 });

    await launchReview(baseLaunch);

    expect(updateReviewDiffs).toHaveBeenCalledWith('rev-1', [{ filePath: 'a.ts' }], 'abc123');
    expect(dbQueries.createReview).not.toHaveBeenCalled();
    expect(startServer).toHaveBeenCalledWith(4183, 'rev-1', '/repo', { noOpen: true, strictPort: false, onComplete: null });
    expect(logged(logSpy)).toContain('2 stale annotation(s)');
  });

  it('resumes an in-progress review at a different HEAD as-is when --resume is passed', async () => {
    dbQueries.getLatestInProgressReview.mockResolvedValue({ id: 'rev-1', head_commit: 'old-head', created_at: '2026-01-01' });

    await launchReview({ ...baseLaunch, resume: true });

    expect(updateReviewDiffs).not.toHaveBeenCalled();
    expect(dbQueries.createReview).not.toHaveBeenCalled();
    expect(gitDiff.getFileDiffs).not.toHaveBeenCalled();
    expect(startServer).toHaveBeenCalledWith(4183, 'rev-1', '/repo', expect.anything());
    expect(logged(logSpy)).toContain('Resuming review rev-1');
  });

  it('creates a fresh review when the existing one is at a different HEAD and --resume is absent', async () => {
    dbQueries.getLatestInProgressReview.mockResolvedValue({ id: 'rev-1', head_commit: 'old-head', created_at: 'now' });
    gitDiff.getFileDiffs.mockReturnValue([{ filePath: 'a.ts' }]);
    dbQueries.createReview.mockResolvedValue({ id: 'rev-2' });
    dbQueries.addReviewFile.mockResolvedValue({});

    await launchReview(baseLaunch);

    expect(updateReviewDiffs).not.toHaveBeenCalled();
    expect(dbQueries.createReview).toHaveBeenCalledWith('/repo', 'repo', 'uncommitted', '', 'abc123');
    expect(startServer).toHaveBeenCalledWith(4183, 'rev-2', '/repo', expect.anything());
  });

  it('says so and starts fresh when --resume finds nothing in progress', async () => {
    dbQueries.getLatestInProgressReview.mockResolvedValue(undefined);
    gitDiff.getFileDiffs.mockReturnValue([{ filePath: 'a.ts' }]);
    dbQueries.createReview.mockResolvedValue({ id: 'rev-3' });
    dbQueries.addReviewFile.mockResolvedValue({});

    await launchReview({ ...baseLaunch, resume: true });

    expect(logged(logSpy)).toContain('No in-progress review found');
    expect(startServer).toHaveBeenCalledWith(4183, 'rev-3', '/repo', expect.anything());
  });

  it('exits 0 without creating anything when the mode yields no diffs', async () => {
    dbQueries.getLatestInProgressReview.mockResolvedValue(undefined);
    gitDiff.getFileDiffs.mockReturnValue([]);

    await expect(launchReview(baseLaunch)).rejects.toThrow(ExitSentinel);

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logged(logSpy)).toContain('No changes found');
    expect(dbQueries.createReview).not.toHaveBeenCalled();
    expect(startServer).not.toHaveBeenCalled();
  });

  it('attaches ground-truth perceptual scores per file (null for unscored files)', async () => {
    dbQueries.getLatestInProgressReview.mockResolvedValue(undefined);
    gitDiff.getFileDiffs.mockReturnValue([{ filePath: 'scored.png' }, { filePath: 'unscored.png' }]);
    dbQueries.createReview.mockResolvedValue({ id: 'rev-4' });
    dbQueries.addReviewFile.mockResolvedValue({});

    const scores = new Map<string, number | null>([['scored.png', 0.25]]);
    await launchReview({ ...baseLaunch, groundTruthScores: scores });

    expect(dbQueries.addReviewFile).toHaveBeenCalledWith('rev-4', 'scored.png', expect.any(String), 0.25);
    expect(dbQueries.addReviewFile).toHaveBeenCalledWith('rev-4', 'unscored.png', expect.any(String), null);
  });
});

describe('resolveGroundTruthLaunch', () => {
  let dir: string;

  const gtMode = (manifestPath: string) =>
    ({ type: 'ground-truth', manifestPath, comparisons: [] }) as Extract<ReviewMode, { type: 'ground-truth' }>;

  function entry(key: string, actual: string, expected: string) {
    return { key, actualPath: actual, expectedPath: expected };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'glassbox-gt-launch-'));
    writeFileSync(join(dir, 'actual.png'), 'a');
    writeFileSync(join(dir, 'expected.png'), 'e');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 1 with the manifest error when the manifest fails to load', async () => {
    loadGroundTruthManifest.mockImplementation(() => { throw new Error('manifest is not valid JSON'); });

    await expect(resolveGroundTruthLaunch(gtMode('/m.json'), dir)).rejects.toThrow(ExitSentinel);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logged(errorSpy)).toContain('manifest is not valid JSON');
  });

  it('exits 1 naming the role and path when an actual image is missing', async () => {
    loadGroundTruthManifest.mockReturnValue([entry('k', join(dir, 'missing.png'), join(dir, 'expected.png'))]);

    await expect(resolveGroundTruthLaunch(gtMode('/m.json'), dir)).rejects.toThrow(ExitSentinel);

    expect(logged(errorSpy)).toContain('actual image does not exist');
    expect(logged(errorSpy)).toContain('missing.png');
  });

  it('exits 1 when an expected image is missing', async () => {
    loadGroundTruthManifest.mockReturnValue([entry('k', join(dir, 'actual.png'), join(dir, 'gone.png'))]);

    await expect(resolveGroundTruthLaunch(gtMode('/m.json'), dir)).rejects.toThrow(ExitSentinel);

    expect(logged(errorSpy)).toContain('expected image does not exist');
  });

  it('initializes content plugins before scoring so decoder plugins can participate', async () => {
    const order: string[] = [];
    loadGroundTruthManifest.mockReturnValue([entry('k', join(dir, 'actual.png'), join(dir, 'expected.png'))]);
    initContentPlugins.mockImplementation(async () => { order.push('plugins'); });
    comparePerceptual.mockImplementation(async () => {
      order.push('score');
      return { scorable: true, score: 0.5, reason: 'ok' };
    });

    await resolveGroundTruthLaunch(gtMode('/m.json'), dir);

    expect(initContentPlugins).toHaveBeenCalledWith(dir);
    expect(order).toEqual(['plugins', 'score']);
  });

  it('returns the resolved comparisons and a score per key', async () => {
    const a = entry('one', join(dir, 'actual.png'), join(dir, 'expected.png'));
    const b = entry('two', join(dir, 'actual.png'), join(dir, 'expected.png'));
    loadGroundTruthManifest.mockReturnValue([a, b]);
    comparePerceptual
      .mockResolvedValueOnce({ scorable: true, score: 0.1, reason: 'ok' })
      .mockResolvedValueOnce({ scorable: false, score: null, reason: 'undecodable' });

    const result = await resolveGroundTruthLaunch(gtMode('/m.json'), dir);

    expect(result.mode.comparisons).toEqual([a, b]);
    expect(result.scores.get('one')).toBe(0.1);
    expect(result.scores.get('two')).toBeNull();
    // one undecodable → summary printed; nothing identical
    expect(logged(logSpy)).toContain('1 not scored (unsupported format)');
    expect(logged(logSpy)).not.toContain('identical');
  });

  it('summarizes identical pairs (hidden by default)', async () => {
    loadGroundTruthManifest.mockReturnValue([entry('same', join(dir, 'actual.png'), join(dir, 'expected.png'))]);
    comparePerceptual.mockResolvedValue({ scorable: true, score: 0, reason: 'ok' });

    await resolveGroundTruthLaunch(gtMode('/m.json'), dir);

    expect(logged(logSpy)).toContain('1 identical (hidden by default)');
  });

  it('prints no summary when every pair differs and is scorable', async () => {
    loadGroundTruthManifest.mockReturnValue([entry('k', join(dir, 'actual.png'), join(dir, 'expected.png'))]);
    comparePerceptual.mockResolvedValue({ scorable: true, score: 0.42, reason: 'ok' });

    await resolveGroundTruthLaunch(gtMode('/m.json'), dir);

    expect(logged(logSpy)).not.toContain('Perceptual diff:');
  });
});

describe('runDifftoolServe', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = join(mkdtempSync(join(tmpdir(), 'glassbox-dt-serve-')), 'data');
    dbQueries.createReview.mockResolvedValue({ id: 'dt-rev' });
    startServer.mockResolvedValue({ port: 5555, server: { close: vi.fn() } });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  const opts = { noOpen: true, strictPort: false, onComplete: null };

  it('boots the accumulating session: dir, gitignore, blob cleanup, review, server, discovery', async () => {
    await runDifftoolServe(dataDir, 4183, opts);

    // Data dir was created and wired up
    expect(setDataDir).toHaveBeenCalledWith(dataDir);
    expect(ensureGlassboxGitignored).toHaveBeenCalledWith(dataDir);
    // Stale blobs from a hard-killed previous session are cleared up front
    expect(clearImageBlobs).toHaveBeenCalledWith(dataDir);
    expect(dbQueries.createReview).toHaveBeenCalledWith(process.cwd(), 'git difftool', 'difftool');
    expect(startServer).toHaveBeenCalledWith(4183, 'dt-rev', process.cwd(), opts);
    // Discovery records the ACTUAL bound port (server may have moved off 4183),
    // then the start election is released so waiting wrappers append.
    expect(discovery.writeDiscovery).toHaveBeenCalledWith(5555);
    expect(discovery.releaseStartingLock).toHaveBeenCalled();
    expect(initDifftoolSession).toHaveBeenCalledWith(expect.objectContaining({
      reviewId: 'dt-rev',
      repoRoot: process.cwd(),
    }));
  });

  it('shutdown callback closes the server, clears blobs + discovery, and exits 0', async () => {
    const close = vi.fn();
    startServer.mockResolvedValue({ port: 5555, server: { close } });

    await runDifftoolServe(dataDir, 4183, opts);
    const { shutdown } = initDifftoolSession.mock.calls[0][0] as { shutdown: () => void };

    clearImageBlobs.mockClear();
    discovery.releaseStartingLock.mockClear();
    expect(() => { shutdown(); }).toThrow(ExitSentinel);

    expect(close).toHaveBeenCalled();
    expect(clearImageBlobs).toHaveBeenCalledWith(dataDir);
    expect(discovery.clearDiscovery).toHaveBeenCalled();
    expect(discovery.releaseStartingLock).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('shutdown tolerates a server that throws on close (already closing)', async () => {
    startServer.mockResolvedValue({
      port: 5555,
      server: { close: () => { throw new Error('already closed'); } },
    });

    await runDifftoolServe(dataDir, 4183, opts);
    const { shutdown } = initDifftoolSession.mock.calls[0][0] as { shutdown: () => void };

    expect(() => { shutdown(); }).toThrow(ExitSentinel);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('creates the data directory when it does not exist yet', async () => {
    // dataDir deliberately not created beforehand — mkdirSync recursive in the
    // launcher must handle it. Reaching startServer proves it did not throw.
    await runDifftoolServe(join(dataDir, 'nested', 'deeper'), 4183, opts);
    expect(startServer).toHaveBeenCalled();
  });
});

describe('main', () => {
  const origArgv = process.argv;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'glassbox-main-'));
  });

  afterEach(() => {
    process.argv = origArgv;
    rmSync(tmp, { recursive: true, force: true });
  });

  function runMain(...args: string[]): Promise<void> {
    process.argv = ['node', '/fake/cli.js', ...args];
    return main();
  }

  it('dispatches the note subcommand with the remaining args', async () => {
    vi.mocked(handleNoteSubcommand).mockImplementation(async () => { throw new ExitSentinel(0); });
    await expect(runMain('note', 'add', '--file', 'a.ts')).rejects.toThrow(ExitSentinel);
    expect(handleNoteSubcommand).toHaveBeenCalledWith(['add', '--file', 'a.ts']);
  });

  it('dispatches --register-difftool with the local/force flags', async () => {
    vi.mocked(handleDifftoolRegistration).mockImplementation(async () => { throw new ExitSentinel(0); });
    await expect(runMain('--register-difftool', '--local', '--force')).rejects.toThrow(ExitSentinel);
    expect(handleDifftoolRegistration).toHaveBeenCalledWith('register', true, true);
  });

  it('rejects a --project-dir that is not a directory', async () => {
    const file = join(tmp, 'not-a-dir');
    writeFileSync(file, 'x');
    await expect(runMain('--project-dir', file)).rejects.toThrow(ExitSentinel);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logged(errorSpy)).toContain('--project-dir is not a directory');
  });

  it('chdirs into a valid --project-dir before resolving anything else', async () => {
    const chdirSpy = vi.spyOn(process, 'chdir').mockImplementation(() => {});
    gitDiff.isGitRepo.mockReturnValue(false);
    await expect(runMain('--project-dir', tmp, '--data-dir', tmp)).rejects.toThrow(ExitSentinel);
    expect(chdirSpy).toHaveBeenCalledWith(tmp);
    expect(logged(errorSpy)).toContain('Not a git repository');
  });

  it('lists the available scenarios and exits 1 for an unknown demo id', async () => {
    await expect(runMain('--demo:7')).rejects.toThrow(ExitSentinel);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logged(errorSpy)).toContain('Unknown demo scenario: 7');
    expect(logged(errorSpy)).toContain('--demo:1  Demo One');
  });

  it('runs a demo review without taking the single-instance lock', async () => {
    vi.mocked(setupDemoReview).mockResolvedValue({ reviewId: 'demo-rev' } as never);
    await runMain('--demo:1', '--no-open');
    expect(setDemoMode).toHaveBeenCalledWith(1);
    expect(setupDemoReview).toHaveBeenCalledWith(1);
    expect(acquireLock).not.toHaveBeenCalled();
    expect(startServer).toHaveBeenCalledWith(4183, 'demo-rev', process.cwd(), expect.anything());
  });

  it('rejects --diff when a path does not exist', async () => {
    const a = join(tmp, 'a.txt');
    writeFileSync(a, 'a');
    await expect(runMain('--diff', a, join(tmp, 'missing.txt'), '--data-dir', tmp)).rejects.toThrow(ExitSentinel);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logged(errorSpy)).toContain('path does not exist');
    expect(logged(errorSpy)).toContain('missing.txt');
  });

  it('rejects --diff mixing a file with a folder', async () => {
    const a = join(tmp, 'a.txt');
    writeFileSync(a, 'a');
    await expect(runMain('--diff', a, tmp, '--data-dir', tmp)).rejects.toThrow(ExitSentinel);
    expect(logged(errorSpy)).toContain('not a mix of both');
  });

  it('labels a --diff review by the two basenames and needs no git repo', async () => {
    const a = join(tmp, 'before.txt');
    const b = join(tmp, 'after.txt');
    writeFileSync(a, 'a');
    writeFileSync(b, 'b');
    gitDiff.getFileDiffs.mockReturnValue([{ filePath: 'before.txt' }]);
    dbQueries.getLatestInProgressReview.mockResolvedValue(undefined);
    dbQueries.createReview.mockResolvedValue({ id: 'diff-rev' });
    dbQueries.addReviewFile.mockResolvedValue({});
    vi.mocked(ensureSkills).mockReturnValueOnce(['Claude Code']);
    ensureGlassboxGitignored.mockReturnValueOnce({ changed: true });

    await runMain('--diff', a, b, '--data-dir', tmp, '--no-open', '--ai-service-test');

    expect(gitDiff.isGitRepo).not.toHaveBeenCalled();
    expect(dbQueries.createReview).toHaveBeenCalledWith(
      process.cwd(), 'before.txt ↔ after.txt', 'uncommitted', '', '');
    expect(acquireLock).toHaveBeenCalled();
    const out = logged(logSpy);
    expect(out).toContain('Updated .gitignore');
    expect(out).toContain('AI tool skills created/updated for: Claude Code');
    expect(out).toContain('AI service test mode enabled');
  });

  it('threads ground-truth manifest resolution + scores through to the review files', async () => {
    const actual = join(tmp, 'actual.png');
    const expected = join(tmp, 'expected.png');
    writeFileSync(actual, 'a');
    writeFileSync(expected, 'e');
    loadGroundTruthManifest.mockReturnValue([
      { key: 'shot.png', actualPath: actual, expectedPath: expected },
    ]);
    comparePerceptual.mockResolvedValue({ scorable: true, score: 0.33, reason: 'ok' });
    gitDiff.getFileDiffs.mockReturnValue([{ filePath: 'shot.png' }]);
    dbQueries.getLatestInProgressReview.mockResolvedValue(undefined);
    dbQueries.createReview.mockResolvedValue({ id: 'gt-rev' });
    dbQueries.addReviewFile.mockResolvedValue({});

    await runMain('--ground-truth', join(tmp, 'manifest.json'), '--data-dir', tmp, '--no-open');

    expect(dbQueries.createReview).toHaveBeenCalledWith(
      process.cwd(), 'Ground truth: manifest.json', 'uncommitted', '', '');
    expect(dbQueries.addReviewFile).toHaveBeenCalledWith('gt-rev', 'shot.png', expect.any(String), 0.33);
  });

  it('requires a git repository for the git-backed modes', async () => {
    gitDiff.isGitRepo.mockReturnValue(false);
    await expect(runMain('--uncommitted', '--data-dir', tmp)).rejects.toThrow(ExitSentinel);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logged(errorSpy)).toContain('Not a git repository');
  });

  it('resolves repo root/name/HEAD for a git-backed mode and scans it', async () => {
    gitDiff.isGitRepo.mockReturnValue(true);
    gitDiff.getRepoRoot.mockReturnValue('/repo');
    gitDiff.getRepoName.mockReturnValue('my-repo');
    gitDiff.getHeadCommit.mockReturnValue('head-1');
    dbQueries.getLatestInProgressReview.mockResolvedValue(undefined);
    gitDiff.getFileDiffs.mockReturnValue([]);

    // Empty diff set short-circuits with exit 0 after the scan.
    await expect(runMain('--staged', '--data-dir', tmp)).rejects.toThrow(ExitSentinel);

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(gitDiff.getHeadCommit).toHaveBeenCalled();
    expect(logged(logSpy)).toContain('my-repo');
    expect(logged(logSpy)).toContain('No changes found');
  });
});
