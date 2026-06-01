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

  it('delegates to the desktop launcher shim when running in a bundle (GB-855)', () => {
    const target = resolveLaunchTarget(macBundleServerDir, (p) => p === macLauncher);
    expect(target).toEqual({ kind: 'desktop', launcher: macLauncher });
  });

  it('falls back to the sibling cli.js for an npm install (no launcher shim)', () => {
    const npmDist = '/Users/me/node_modules/glassbox/dist';
    const target = resolveLaunchTarget(npmDist, () => false);
    expect(target).toEqual({ kind: 'browser', cli: '/Users/me/node_modules/glassbox/dist/cli.js' });
  });

  it('falls back to browser when the probed launcher path does not exist', () => {
    // A dev running dist/cli-difftool.js directly: no top-level resources/ shim.
    const target = resolveLaunchTarget('/repo/dist', () => false);
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
