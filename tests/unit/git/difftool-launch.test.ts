import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DIFFTOOL_BLOCK_ENV,
  isDirDiffInvocation,
  parseGitDiffCounter,
  planSnapshot,
  resolveLaunchTarget,
  shouldHoldForSession,
} from '../../../src/git/difftool-launch.js';

// node:path.join produces native separators (backslashes on Windows); these
// tests assert the path *logic*, not the separator style, so normalize before
// comparing. Production code keeps native separators on purpose — that's what
// cpSync / existsSync want.
const norm = (p: string): string => p.replace(/\\/g, '/');
const normPlan = (p: ReturnType<typeof planSnapshot>) => ({
  leftArg: norm(p.leftArg),
  rightArg: norm(p.rightArg),
  copies: p.copies.map((c) => ({ from: norm(c.from), to: norm(c.to) })),
});
const normTarget = (t: ReturnType<typeof resolveLaunchTarget>) =>
  t.kind === 'desktop'
    ? { kind: t.kind, launcher: norm(t.launcher) }
    : { kind: t.kind, cli: norm(t.cli) };

// GB-854 / GB-855 — the wrapper's two decisions, tested without spawning a
// real review: where to dereference (dir-diff vs per-file) and what to launch
// (desktop bundle vs npm install).

describe('planSnapshot', () => {
  it('uses bare left/right roots for --dir-diff (directory inputs)', () => {
    const plan = planSnapshot('/git/left', '/git/right', '/work', false, basename);
    expect(normPlan(plan)).toEqual({
      leftArg: '/work/left',
      rightArg: '/work/right',
      copies: [
        { from: '/git/left', to: '/work/left' },
        { from: '/git/right', to: '/work/right' },
      ],
    });
  });

  it('preserves the filename for a per-file invocation (GB-854)', () => {
    // git per-file mode passes two single files; we want the review labeled
    // with the file, not "left ↔ right".
    const plan = planSnapshot(
      '/tmp/git-blob-aaa/strings.ts',
      '/tmp/git-blob-bbb/strings.ts',
      '/work',
      true,
      basename,
    );
    expect(normPlan(plan)).toEqual({
      leftArg: '/work/left/strings.ts',
      rightArg: '/work/right/strings.ts',
      copies: [
        { from: '/tmp/git-blob-aaa/strings.ts', to: '/work/left/strings.ts' },
        { from: '/tmp/git-blob-bbb/strings.ts', to: '/work/right/strings.ts' },
      ],
    });
  });

  it('takes the per-file name from the remote (working-tree) side across a rename', () => {
    const plan = planSnapshot('/a/old-name.ts', '/b/new-name.ts', '/work', true, basename);
    expect(norm(plan.leftArg)).toBe('/work/left/new-name.ts');
    expect(norm(plan.rightArg)).toBe('/work/right/new-name.ts');
  });

  it('falls back to a literal "file" name when basenames are empty', () => {
    const plan = planSnapshot('/', '/', '/work', true, basename);
    expect(norm(plan.leftArg)).toBe('/work/left/file');
    expect(norm(plan.rightArg)).toBe('/work/right/file');
  });
});

// GB-1000 — the per-file vs `--dir-diff` discriminator. The bug: an added file
// in `git difftool --cached` has `$LOCAL` = `/dev/null` (a char device, not a
// regular file), so the old `isFile()` test wrongly classified it as `--dir-diff`
// and sent it down the blocking single-file launch, breaking accumulation ("one
// file at a time"). The fix keys on "is the left input a directory" instead.
describe('isDirDiffInvocation', () => {
  const dir = () => ({ isDirectory: () => true });
  const file = () => ({ isDirectory: () => false });

  it('is true for --dir-diff (left input is a directory)', () => {
    expect(isDirDiffInvocation('/work/left', dir)).toBe(true);
  });

  it('is false for a per-file invocation (left input is a regular file)', () => {
    expect(isDirDiffInvocation('/tmp/git-blob-aaa/f1.txt', file)).toBe(false);
  });

  it('is false for an added file whose $LOCAL is /dev/null (GB-1000)', () => {
    // statSync('/dev/null').isDirectory() is false — the key case the old
    // isFile() check got wrong (isFile() is ALSO false for /dev/null).
    expect(isDirDiffInvocation('/dev/null', file)).toBe(false);
  });

  it('is false (per-file) when the path cannot be stat-ed', () => {
    const throwing = (): { isDirectory: () => boolean } => { throw new Error('ENOENT'); };
    expect(isDirDiffInvocation('/missing', throwing)).toBe(false);
  });
});

describe('resolveLaunchTarget', () => {
  const macBundleServerDir = '/Applications/Glassbox.app/Contents/Resources/server';
  const macLauncher = '/Applications/Glassbox.app/Contents/Resources/resources/glassbox';

  it('delegates to the macOS launcher shim when running in a macOS bundle (GB-855)', () => {
    const target = resolveLaunchTarget(macBundleServerDir, (p) => norm(p) === macLauncher, 'darwin');
    expect(normTarget(target)).toEqual({ kind: 'desktop', launcher: macLauncher });
  });

  it('delegates to the Linux launcher shim from the verified .deb layout (GB-856)', () => {
    // Linux deb: cli-difftool.js at /usr/lib/Glassbox/server, launcher at
    // /usr/lib/Glassbox/resources/glassbox-linux.
    const linuxServerDir = '/usr/lib/Glassbox/server';
    const linuxLauncher = '/usr/lib/Glassbox/resources/glassbox-linux';
    const target = resolveLaunchTarget(linuxServerDir, (p) => norm(p) === linuxLauncher, 'linux');
    expect(normTarget(target)).toEqual({ kind: 'desktop', launcher: linuxLauncher });
  });

  it('does NOT match the macOS shim on Linux even though the bundle ships it (GB-856)', () => {
    // The bundle includes every platform's shim. On Linux we must pick
    // glassbox-linux, not the bare `glassbox` (the macOS shim, which uses
    // `open -a` and would fail). Here both files "exist"; platform decides.
    const linuxServerDir = '/usr/lib/Glassbox/server';
    const target = resolveLaunchTarget(linuxServerDir, () => true, 'linux');
    expect(normTarget(target)).toEqual({ kind: 'desktop', launcher: '/usr/lib/Glassbox/resources/glassbox-linux' });
  });

  it('falls back to the sibling cli.js for an npm install (no launcher shim)', () => {
    const npmDist = '/Users/me/node_modules/glassbox/dist';
    const target = resolveLaunchTarget(npmDist, () => false, 'darwin');
    expect(normTarget(target)).toEqual({ kind: 'browser', cli: '/Users/me/node_modules/glassbox/dist/cli.js' });
  });

  it('delegates to the Windows launcher .cmd when present (GB-856)', () => {
    // Windows build layout: cli-difftool.js in <install>\server, launcher at
    // <install>\resources\glassbox.cmd.
    const winServerDir = 'C:/app/server';
    const winLauncher = 'C:/app/resources/glassbox.cmd';
    const target = resolveLaunchTarget(winServerDir, (p) => norm(p) === winLauncher, 'win32');
    expect(normTarget(target)).toEqual({ kind: 'desktop', launcher: winLauncher });
  });

  it('falls back to browser on platforms with no launcher mapping (e.g. freebsd)', () => {
    const target = resolveLaunchTarget('/app/server', () => true, 'freebsd');
    expect(target.kind).toBe('browser');
  });

  it('falls back to browser when the probed launcher path does not exist', () => {
    const target = resolveLaunchTarget('/repo/dist', () => false, 'linux');
    expect(target.kind).toBe('browser');
  });
});

describe('parseGitDiffCounter', () => {
  it('parses a valid 1-based counter/total pair', () => {
    expect(parseGitDiffCounter({ GIT_DIFF_PATH_COUNTER: '2', GIT_DIFF_PATH_TOTAL: '3' }))
      .toEqual({ counter: 2, total: 3 });
  });

  it('returns null when either var is missing (older git — FR-19.10)', () => {
    expect(parseGitDiffCounter({ GIT_DIFF_PATH_TOTAL: '3' })).toBeNull();
    expect(parseGitDiffCounter({ GIT_DIFF_PATH_COUNTER: '1' })).toBeNull();
    expect(parseGitDiffCounter({})).toBeNull();
  });

  it('returns null for non-integer or out-of-range values', () => {
    expect(parseGitDiffCounter({ GIT_DIFF_PATH_COUNTER: 'x', GIT_DIFF_PATH_TOTAL: '3' })).toBeNull();
    expect(parseGitDiffCounter({ GIT_DIFF_PATH_COUNTER: '0', GIT_DIFF_PATH_TOTAL: '3' })).toBeNull();
    // counter past total is nonsensical
    expect(parseGitDiffCounter({ GIT_DIFF_PATH_COUNTER: '4', GIT_DIFF_PATH_TOTAL: '3' })).toBeNull();
  });
});

describe('shouldHoldForSession', () => {
  it('holds only on the last file (counter == total)', () => {
    expect(shouldHoldForSession({ GIT_DIFF_PATH_COUNTER: '3', GIT_DIFF_PATH_TOTAL: '3' })).toBe(true);
    expect(shouldHoldForSession({ GIT_DIFF_PATH_COUNTER: '1', GIT_DIFF_PATH_TOTAL: '3' })).toBe(false);
    expect(shouldHoldForSession({ GIT_DIFF_PATH_COUNTER: '2', GIT_DIFF_PATH_TOTAL: '3' })).toBe(false);
  });

  it('never holds when the counter is unavailable (FR-19.10 — rely on Done/tab-close)', () => {
    expect(shouldHoldForSession({})).toBe(false);
    expect(shouldHoldForSession({ GIT_DIFF_PATH_TOTAL: '1' })).toBe(false);
  });

  it('holds for a single-file run (1 of 1)', () => {
    expect(shouldHoldForSession({ GIT_DIFF_PATH_COUNTER: '1', GIT_DIFF_PATH_TOTAL: '1' })).toBe(true);
  });
});

describe('DIFFTOOL_BLOCK_ENV', () => {
  it('matches the env var the launcher shim checks', () => {
    // If this string drifts from `src-tauri/resources/glassbox`, the desktop
    // launch stops blocking and the temp tree is torn down mid-session.
    expect(DIFFTOOL_BLOCK_ENV).toBe('GLASSBOX_DIFFTOOL_BLOCK');
  });
});
