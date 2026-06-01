/**
 * `glassbox-difftool` — git-difftool bridge for Glassbox.
 *
 * Invoked as `git difftool --dir-diff <refA> <refB>` (or per-file, see below)
 * via:
 *   git config --global diff.tool glassbox
 *   git config --global difftool.glassbox.cmd 'glassbox-difftool "$LOCAL" "$REMOTE"'
 *   git config --global difftool.prompt false
 *
 * Why this is more than a one-line forwarder
 * ------------------------------------------
 * `git difftool --dir-diff` materializes its two snapshot dirs asymmetrically:
 *
 *   - **left** dir: regular files, content from refA.
 *   - **right** dir: **symlinks pointing into the working tree** (even when
 *     refB is not HEAD — git always uses the working tree on the right).
 *
 * `git diff --no-index <left> <right>` (Glassbox's underlying engine) sees
 * `regular file` vs `symlink` and reports every modified file as
 * `deleted from left + added to right` rather than a single modified entry.
 * For a 12-file commit that comes out as 23 noise entries.
 *
 * The fix: before handing the dirs to `glassbox --diff`, dereference any
 * symlinks into a parallel temp tree of regular files. Node's `fs.cpSync`
 * with `recursive: true` and `dereference: true` does exactly that. The
 * temp tree is removed on exit so we don't leak per-invocation directories.
 *
 * Two modes
 * ---------
 *  - **`--dir-diff`** (recommended): one invocation, two directory snapshots.
 *  - **per-file** (`git difftool <a> <b>` with no `--dir-diff`): git invokes us
 *    once per changed file with two single files, waiting for each to exit
 *    before the next. We open a one-file review per invocation; the launch
 *    blocks until the window closes so git steps through files one at a time
 *    (like a traditional difftool). See `git/difftool-launch.ts`.
 *
 * Desktop vs browser
 * ------------------
 * When this wrapper runs from a desktop bundle it delegates to the bundled
 * `glassbox` launcher shim so the review opens in the Tauri window — matching
 * what `glassbox --commit` does from the same folder. From an `npm install`
 * it runs `cli.js` directly, opening the browser. Either way the launch is
 * blocking, which both keeps the dereferenced temp tree alive for the whole
 * session and sequences per-file mode correctly.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIFFTOOL_BLOCK_ENV, planSnapshot, resolveLaunchTarget } from './git/difftool-launch.js';

const args = process.argv.slice(2);
if (args.length < 2 || args[0].startsWith('-') || args[1].startsWith('-')) {
  console.error('usage: glassbox-difftool <local> <remote> [extra glassbox args...]');
  console.error('');
  console.error('Configure as a git difftool:');
  console.error('  git config --global diff.tool glassbox');
  console.error("  git config --global difftool.glassbox.cmd 'glassbox-difftool \"$LOCAL\" \"$REMOTE\"'");
  console.error('  git config --global difftool.prompt false');
  console.error('');
  console.error('Then either:');
  console.error('  git difftool --dir-diff HEAD~1 HEAD   # whole change set in one review (recommended)');
  console.error('  git difftool HEAD~1 HEAD              # step through changed files one at a time');
  process.exit(1);
}

const [local, remote, ...extra] = args;

// `--dir-diff` hands us directories; per-file mode hands us single files.
// `planSnapshot` preserves the filename in the per-file case so the review
// isn't labeled "left ↔ right".
let localIsFile = false;
try { localIsFile = statSync(local).isFile(); } catch { /* treat as dir */ }

// One temp tree per invocation, removed on exit.
const work = mkdtempSync(join(tmpdir(), 'glassbox-difftool-'));
const plan = planSnapshot(local, remote, work, localIsFile, basename);

function cleanup(): void {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// If the wrapper is killed mid-flight (Ctrl-C, etc.), still try to drop the
// temp tree. The launch below is blocking and propagates signals to the child,
// so the wrapper usually exits via the finally; these handlers cover edge cases.
const signalExit = (code: number) => () => { cleanup(); process.exit(code); };
process.on('SIGINT', signalExit(130));
process.on('SIGTERM', signalExit(143));

try {
  // `dereference: true` follows symlinks and copies the resolved content.
  // This is the whole point of the wrapper.
  for (const { from, to } of plan.copies) {
    cpSync(from, to, { recursive: true, dereference: true });
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const target = resolveLaunchTarget(here, (p) => { try { statSync(p); return true; } catch { return false; } });

  const diffArgs = ['--diff', plan.leftArg, plan.rightArg, ...extra];

  if (target.kind === 'desktop') {
    // Delegate to the bundled launcher shim, which starts the server and opens
    // the Tauri window. The block env var tells it to wait for the window to
    // close before returning (so we don't tear down the temp tree early and so
    // per-file mode advances one file at a time).
    const res = spawnSync(target.launcher, diffArgs, {
      stdio: 'inherit',
      env: { ...process.env, [DIFFTOOL_BLOCK_ENV]: '1' },
    });
    process.exit(res.status ?? 0);
  } else {
    // npm install: run cli.js directly (opens the browser). The server runs in
    // the foreground, so spawnSync blocks for the whole session.
    const res = spawnSync(process.execPath, [target.cli, ...diffArgs], { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  }
} finally {
  cleanup();
}
