import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DIFFTOOL_BLOCK_ENV,
  planSnapshot,
  resolveLaunchTarget,
} from '../../../src/git/difftool-launch.js';

// GB-854 / GB-855 — the wrapper's two decisions, tested without spawning a
// real review: where to dereference (dir-diff vs per-file) and what to launch
// (desktop bundle vs npm install).

describe('planSnapshot', () => {
  it('uses bare left/right roots for --dir-diff (directory inputs)', () => {
    const plan = planSnapshot('/git/left', '/git/right', '/work', false, basename);
    expect(plan.leftArg).toBe('/work/left');
    expect(plan.rightArg).toBe('/work/right');
    expect(plan.copies).toEqual([
      { from: '/git/left', to: '/work/left' },
      { from: '/git/right', to: '/work/right' },
    ]);
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
    expect(plan.leftArg).toBe('/work/left/strings.ts');
    expect(plan.rightArg).toBe('/work/right/strings.ts');
    expect(plan.copies).toEqual([
      { from: '/tmp/git-blob-aaa/strings.ts', to: '/work/left/strings.ts' },
      { from: '/tmp/git-blob-bbb/strings.ts', to: '/work/right/strings.ts' },
    ]);
  });

  it('takes the per-file name from the remote (working-tree) side across a rename', () => {
    const plan = planSnapshot('/a/old-name.ts', '/b/new-name.ts', '/work', true, basename);
    expect(plan.leftArg).toBe('/work/left/new-name.ts');
    expect(plan.rightArg).toBe('/work/right/new-name.ts');
  });

  it('falls back to a literal "file" name when basenames are empty', () => {
    const plan = planSnapshot('/', '/', '/work', true, basename);
    expect(plan.leftArg).toBe('/work/left/file');
    expect(plan.rightArg).toBe('/work/right/file');
  });
});

describe('resolveLaunchTarget', () => {
  const macBundleServerDir = '/Applications/Glassbox.app/Contents/Resources/server';
  const macLauncher = '/Applications/Glassbox.app/Contents/Resources/resources/glassbox';

  it('delegates to the macOS launcher shim when running in a macOS bundle (GB-855)', () => {
    const target = resolveLaunchTarget(macBundleServerDir, (p) => p === macLauncher, 'darwin');
    expect(target).toEqual({ kind: 'desktop', launcher: macLauncher });
  });

  it('delegates to the Linux launcher shim from the verified .deb layout (GB-856)', () => {
    // Linux deb: cli-difftool.js at /usr/lib/Glassbox/server, launcher at
    // /usr/lib/Glassbox/resources/glassbox-linux.
    const linuxServerDir = '/usr/lib/Glassbox/server';
    const linuxLauncher = '/usr/lib/Glassbox/resources/glassbox-linux';
    const target = resolveLaunchTarget(linuxServerDir, (p) => p === linuxLauncher, 'linux');
    expect(target).toEqual({ kind: 'desktop', launcher: linuxLauncher });
  });

  it('does NOT match the macOS shim on Linux even though the bundle ships it (GB-856)', () => {
    // The bundle includes every platform's shim. On Linux we must pick
    // glassbox-linux, not the bare `glassbox` (the macOS shim, which uses
    // `open -a` and would fail). Here both files "exist"; platform decides.
    const linuxServerDir = '/usr/lib/Glassbox/server';
    const target = resolveLaunchTarget(linuxServerDir, () => true, 'linux');
    expect(target).toEqual({ kind: 'desktop', launcher: '/usr/lib/Glassbox/resources/glassbox-linux' });
  });

  it('falls back to the sibling cli.js for an npm install (no launcher shim)', () => {
    const npmDist = '/Users/me/node_modules/glassbox/dist';
    const target = resolveLaunchTarget(npmDist, () => false, 'darwin');
    expect(target).toEqual({ kind: 'browser', cli: '/Users/me/node_modules/glassbox/dist/cli.js' });
  });

  it('falls back to browser on platforms with no verified desktop launch (e.g. win32)', () => {
    // Windows desktop launch isn't enabled yet; even with files present we
    // take the browser path until it's verified (GB-856).
    const target = resolveLaunchTarget('C:/app/server', () => true, 'win32');
    expect(target.kind).toBe('browser');
  });

  it('falls back to browser when the probed launcher path does not exist', () => {
    const target = resolveLaunchTarget('/repo/dist', () => false, 'linux');
    expect(target.kind).toBe('browser');
  });
});

describe('DIFFTOOL_BLOCK_ENV', () => {
  it('matches the env var the launcher shim checks', () => {
    // If this string drifts from `src-tauri/resources/glassbox`, the desktop
    // launch stops blocking and the temp tree is torn down mid-session.
    expect(DIFFTOOL_BLOCK_ENV).toBe('GLASSBOX_DIFFTOOL_BLOCK');
  });
});
