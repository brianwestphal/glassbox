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

/**
 * Whether this is git's `--dir-diff` mode (one invocation, two directory
 * snapshots) as opposed to per-file mode (one invocation per changed file, with
 * two single files). `--dir-diff` is the *only* mode that hands us directories;
 * per-file always hands us files — including the `/dev/null` placeholder git
 * uses for the absent side of an **added** file (`$LOCAL`) or a **deleted** file
 * (`$REMOTE`). So the robust discriminator is simply "is the left input a
 * directory".
 *
 * The naive alternative — `statSync(local).isFile()` — misclassifies an added
 * file, whose `$LOCAL` is `/dev/null` (a character device, not a regular file,
 * so `isFile()` is `false`). That sent added files down the blocking
 * single-file launch instead of the accumulating thin client, so
 * `git difftool --cached` over staged *new* files opened one blocking review per
 * file ("only shows one file at a time"). Unstaged `git difftool` never lists
 * untracked/added files, which is why it appeared to work. Treating anything
 * that isn't a directory (a regular file, `/dev/null`, or a path that doesn't
 * stat) as per-file fixes it.
 *
 * `stat` is injected so the decision is unit-testable without a filesystem.
 */
export function isDirDiffInvocation(
  local: string,
  stat: (p: string) => { isDirectory: () => boolean },
): boolean {
  try {
    return stat(local).isDirectory();
  } catch {
    // `/dev/null`, a missing path, or an unreadable one is never a `--dir-diff`
    // directory snapshot — treat it as a per-file invocation.
    return false;
  }
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

export interface GitDiffCounter {
  /** 1-based index of the file git is currently showing. */
  counter: number;
  /** Total number of files in this `git difftool` run. */
  total: number;
}

/**
 * Parse git's per-file position env vars (`GIT_DIFF_PATH_COUNTER` /
 * `GIT_DIFF_PATH_TOTAL`). Returns `null` when either is absent or not a
 * positive integer — an older or differently-configured git that doesn't set
 * them (doc 19, FR-19.10), in which case the wrapper falls back to append+exit
 * with no terminal hold.
 */
export function parseGitDiffCounter(env: Record<string, string | undefined>): GitDiffCounter | null {
  const counter = Number(env.GIT_DIFF_PATH_COUNTER);
  const total = Number(env.GIT_DIFF_PATH_TOTAL);
  if (!Number.isInteger(counter) || !Number.isInteger(total)) return null;
  if (counter < 1 || total < 1 || counter > total) return null;
  return { counter, total };
}

/**
 * Whether this per-file invocation is the final file of the session, so the
 * wrapper should HOLD the terminal open after appending (doc 19, FR-19.5).
 * False when the counter is unavailable — the session then relies purely on the
 * server-side end signals (Done / tab close), per FR-19.10.
 */
export function shouldHoldForSession(env: Record<string, string | undefined>): boolean {
  const c = parseGitDiffCounter(env);
  return c !== null && c.counter === c.total;
}

/** Env var the wrapper sets to tell the desktop launcher shim to block until
 *  the review window closes (instead of its usual fire-and-forget exit). The
 *  shim `wait`s on the backgrounded server; closing the Tauri window kills the
 *  server, which lets the shim — and the wrapper, and git — proceed. Blocking
 *  is what makes per-file `git difftool` step through files one at a time. */
export const DIFFTOOL_BLOCK_ENV = 'GLASSBOX_DIFFTOOL_BLOCK';
