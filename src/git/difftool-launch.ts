/**
 * Pure decision logic for the `glassbox-difftool` wrapper (`src/cli-difftool.ts`).
 *
 * Extracted from the wrapper script so it can be unit-tested without spawning a
 * real review. Two decisions live here:
 *
 *  1. **Where to dereference** — `planSnapshot()` turns git's `$LOCAL` / `$REMOTE`
 *     inputs into the two paths handed to `glassbox --diff`. For `--dir-diff`
 *     (directory inputs) the two roots become `<work>/left` and `<work>/right`.
 *     For per-file invocations (`git difftool <a> <b>` with no `--dir-diff`,
 *     where git calls us once per changed file with two single files) we
 *     preserve the real filename — `<work>/left/<name>` / `<work>/right/<name>` —
 *     so the review is labeled with the file under review, not "left ↔ right".
 *
 *  2. **What to launch** — `resolveLaunchTarget()` decides between the desktop
 *     app and the browser. When this file is running inside a desktop bundle, a
 *     sibling launcher shim sits next to it; delegating to that shim launches
 *     the Tauri window (matching what `glassbox --commit` does from the same
 *     folder). Otherwise — an `npm install -g` checkout — we fall back to
 *     running `cli.js` directly, which opens the browser.
 */
import { join } from 'node:path';

export interface SnapshotPlan {
  /** Path passed as `pathA` to `glassbox --diff`. */
  leftArg: string;
  /** Path passed as `pathB` to `glassbox --diff`. */
  rightArg: string;
  /** Dereferencing copies to perform: each `from` → `to` via `cpSync`. */
  copies: Array<{ from: string; to: string }>;
}

/**
 * Decide the dereference layout. `isFile` is true for a per-file invocation
 * (both inputs are single files), false for `--dir-diff` (directory inputs).
 *
 * For a single file we nest it under a per-side directory keyed by the file's
 * basename so `glassbox --diff` labels the session with the filename. We take
 * the basename from `remote` (git's working-tree side), which is the canonical
 * current name even across a rename.
 */
export function planSnapshot(
  local: string,
  remote: string,
  work: string,
  isFile: boolean,
  basename: (p: string) => string,
): SnapshotPlan {
  if (!isFile) {
    const leftArg = join(work, 'left');
    const rightArg = join(work, 'right');
    return {
      leftArg,
      rightArg,
      copies: [
        { from: local, to: leftArg },
        { from: remote, to: rightArg },
      ],
    };
  }
  const name = basename(remote) || basename(local) || 'file';
  const leftArg = join(work, 'left', name);
  const rightArg = join(work, 'right', name);
  return {
    leftArg,
    rightArg,
    copies: [
      { from: local, to: leftArg },
      { from: remote, to: rightArg },
    ],
  };
}

export type LaunchTarget =
  | { kind: 'desktop'; launcher: string }
  | { kind: 'browser'; cli: string };

/**
 * The per-platform desktop launcher-shim filename, as bundled under the app's
 * `resources/` directory. The bundle ships *all* platforms' shims, so we must
 * pick by the running platform — probing a bare `glassbox` would wrongly match
 * the macOS shim on a Linux box. `null` = no verified desktop launch for this
 * platform yet (falls back to the browser).
 *
 */
function launcherShimName(platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') return 'glassbox';
  if (platform === 'linux') return 'glassbox-linux';
  if (platform === 'win32') return 'glassbox.cmd';
  return null;
}

/**
 * Pick the launch target based on the wrapper's own location and platform.
 *
 * In every desktop bundle the layout is
 *   <resourceDir>/server/cli-difftool.js   (selfDir)
 *   <resourceDir>/resources/<launcher>     (launcher shim)
 * (verified: macOS `Contents/Resources/{server,resources}`, Linux deb
 * `/usr/lib/Glassbox/{server,resources}`). So the launcher is
 * `selfDir/../resources/<launcher>`. If the platform's shim exists we delegate
 * to it (Tauri); otherwise we run the sibling `cli.js` (browser) — the
 * `npm install` layout, where `cli.js` is right next to this file.
 *
 * `exists` and `platform` are injected so the decision is unit-testable.
 */
export function resolveLaunchTarget(
  selfDir: string,
  exists: (p: string) => boolean,
  platform: NodeJS.Platform,
): LaunchTarget {
  const shim = launcherShimName(platform);
  if (shim !== null) {
    const launcher = join(selfDir, '..', 'resources', shim);
    if (exists(launcher)) {
      return { kind: 'desktop', launcher };
    }
  }
  return { kind: 'browser', cli: join(selfDir, 'cli.js') };
}

/** Env var the wrapper sets to tell the desktop launcher shim to block until
 *  the review window closes (instead of its usual fire-and-forget exit). The
 *  shim `wait`s on the backgrounded server; closing the Tauri window kills the
 *  server, which lets the shim — and the wrapper, and git — proceed. Blocking
 *  is what makes per-file `git difftool` step through files one at a time. */
export const DIFFTOOL_BLOCK_ENV = 'GLASSBOX_DIFFTOOL_BLOCK';
