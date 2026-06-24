/**
 * `glassbox-difftool` — git-difftool bridge for Glassbox.
 *
 * Invoked as `git difftool --dir-diff <refA> <refB>` (or per-file, see below)
 * via:
 *   git config --global diff.tool glassbox
 *   git config --global difftool.glassbox.cmd 'glassbox-difftool "$LOCAL" "$REMOTE" "$MERGED"'
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
 *  - **`--dir-diff`** (recommended): one invocation, two directory snapshots —
 *    dereferenced into a temp tree and handed to `glassbox --diff`.
 *  - **per-file** (`git difftool <a> <b>` with no `--dir-diff`): git invokes us
 *    once per changed file with two single files, waiting for each to exit
 *    before the next. This wrapper is a thin client (doc 19): it reads the two
 *    files' content, forwards them to a single long-lived accumulating server,
 *    and returns at once so all files pile into one review — in **one browser
 *    tab** (npm install) or **one desktop window** (Tauri install, GB-861). See
 *    `git/difftool-client.ts`.
 *
 * Desktop vs browser
 * ------------------
 * Per-file mode accumulates the same way in both: the only difference is how the
 * single accumulating server is started. In a **browser** install the wrapper
 * spawns `cli.js --difftool-serve` directly. In a **desktop** install it
 * launches the bundled launcher shim in `--difftool-serve` mode so the review
 * opens in a Tauri window (matching what `glassbox --commit` does from the same
 * folder); closing that window ends the session. `--dir-diff` (either target)
 * stays the original blocking launch so the dereferenced temp tree survives for
 * the whole session.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appendFile,
  DESKTOP_DISCOVER_TIMEOUT_MS,
  discoverOrStartServer,
  holdUntilEnd,
  launchDetachedDesktopSession,
  spawnDetachedBrowserServer,
} from './git/difftool-client.js';
import {
  DIFFTOOL_BLOCK_ENV,
  isDirDiffInvocation,
  planSnapshot,
  resolveLaunchTarget,
  shouldHoldForSession,
} from './git/difftool-launch.js';

const args = process.argv.slice(2);
if (args.length < 2 || args[0].startsWith('-') || args[1].startsWith('-')) {
  console.error('usage: glassbox-difftool <local> <remote> [extra glassbox args...]');
  console.error('');
  console.error('Configure as a git difftool:');
  console.error('  git config --global diff.tool glassbox');
  console.error("  git config --global difftool.glassbox.cmd 'glassbox-difftool \"$LOCAL\" \"$REMOTE\" \"$MERGED\"'");
  console.error('  git config --global difftool.prompt false');
  console.error('');
  console.error('Then either:');
  console.error('  git difftool --dir-diff HEAD~1 HEAD   # whole change set in one review (recommended)');
  console.error('  git difftool HEAD~1 HEAD              # step through changed files one at a time');
  process.exit(1);
}

// Registered cmd is `glassbox-difftool "$LOCAL" "$REMOTE" "$MERGED"`. `merged`
// is git's repo-relative path of the file under diff (per-file mode); it's empty
// for `--dir-diff` and absent for a legacy two-arg registration. Anything beyond
// it is forwarded to `glassbox --diff` (the historical "extra args" escape hatch).
const [local, remote, merged, ...extra] = args;

// `--dir-diff` hands us two directory snapshots; per-file mode hands us single
// files — including `/dev/null` for the absent side of an add/delete, which is
// NOT a regular file, so we discriminate on "is it a directory" rather than "is
// it a file" (else an added file's `/dev/null` `$LOCAL` would be misrouted to
// the blocking dir-diff launch — GB-1000).
const isDirDiff = isDirDiffInvocation(local, statSync);
const isPerFile = !isDirDiff;

const here = dirname(fileURLToPath(import.meta.url));
const target = resolveLaunchTarget(
  here,
  (p) => { try { statSync(p); return true; } catch { return false; } },
  process.platform,
);

/** Read a file into memory, tolerating the absent side of an add/delete (git
 *  passes an empty temp file or /dev/null). */
function readFileOrEmpty(p: string): Buffer {
  try { return readFileSync(p); } catch { return Buffer.alloc(0); }
}

/**
 * Per-file accumulating path (doc 19): read both sides NOW (git deletes the temp
 * files the instant we exit), discover-or-start the single accumulating session
 * via `start`, append the file, and return immediately — except on the final
 * file, where we hold so `git difftool` stays attached until the user clicks
 * "Done" or closes the tab/window. `start` differs only by target: spawn the
 * browser server, or launch the desktop window (GB-861).
 */
async function runThinClient(start: () => void, timeoutMs?: number): Promise<void> {
  const oldContent = readFileOrEmpty(local);
  const newContent = readFileOrEmpty(remote);
  // Prefer git's repo-relative `$MERGED` path so the sidebar shows `src/app.ts`,
  // not a bare `app.ts` (GB-864). Fall back to the working-tree basename (the
  // name that wins across a rename) for a legacy two-arg registration or when
  // git doesn't provide `$MERGED`.
  // `merged` is typed `string` by array destructuring but is empty for
  // `--dir-diff` and absent (undefined at runtime) for a legacy two-arg
  // registration — the `||` chain falls through to the basename in both cases.
  const displayPath = merged || basename(remote) || basename(local) || 'file';

  const port = await discoverOrStartServer(start, timeoutMs);
  await appendFile(port, displayPath, oldContent, newContent);
  if (shouldHoldForSession(process.env)) {
    await holdUntilEnd(port);
  }
}

/**
 * Blocking launch for `--dir-diff` (any target): build the dereferenced temp
 * tree from the two directory snapshots and hand the two roots to
 * `glassbox --diff`. The launch blocks for the whole session, keeping the temp
 * tree alive. Per-file invocations never reach here — they accumulate via the
 * thin client (browser and desktop alike).
 */
function runBlockingLaunch(): never {
  // Reached only for `--dir-diff`, so `isPerFile` is false here and
  // `planSnapshot` uses the bare left/right roots.
  const work = mkdtempSync(join(tmpdir(), 'glassbox-difftool-'));
  const plan = planSnapshot(local, remote, work, isPerFile, basename);

  const cleanup = (): void => {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* best-effort */ }
  };
  // If killed mid-flight (Ctrl-C, etc.), still drop the temp tree.
  const signalExit = (code: number) => (): void => { cleanup(); process.exit(code); };
  process.on('SIGINT', signalExit(130));
  process.on('SIGTERM', signalExit(143));

  try {
    // `dereference: true` follows symlinks and copies the resolved content.
    for (const { from, to } of plan.copies) {
      cpSync(from, to, { recursive: true, dereference: true });
    }

    const diffArgs = ['--diff', plan.leftArg, plan.rightArg, ...extra];

    if (target.kind === 'desktop') {
      // Delegate to the bundled launcher shim, which starts the server and opens
      // the Tauri window. The block env var tells it to wait for the window to
      // close before returning.
      const env = { ...process.env, [DIFFTOOL_BLOCK_ENV]: '1' };
      let res;
      if (process.platform === 'win32') {
        // A `.cmd` launcher must be run through a shell on Windows (Node refuses
        // to spawn batch files directly). Pass one quoted command string with
        // shell:true. Temp paths never contain quotes, so simple quoting is safe.
        const cmd = [target.launcher, ...diffArgs].map((a) => `"${a}"`).join(' ');
        res = spawnSync(cmd, { stdio: 'inherit', env, shell: true });
      } else {
        res = spawnSync(target.launcher, diffArgs, { stdio: 'inherit', env });
      }
      process.exit(res.status ?? 0);
    }
    // npm install: run cli.js directly (opens the browser), blocking for the
    // whole session.
    const res = spawnSync(process.execPath, [target.cli, ...diffArgs], { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  } finally {
    cleanup();
  }
}

const onThinClientDone = (): never => process.exit(0);
const onThinClientError = (err: unknown): never => {
  console.error(err instanceof Error ? err.message : String(err));
  return process.exit(1);
};

// Per-file mode (single files) accumulates into one session for both targets;
// only the "start the session" step differs. `--dir-diff` (directories) keeps
// the original blocking launch so its dereferenced temp tree survives.
if (isPerFile && target.kind === 'browser') {
  const cliPath = target.cli;
  void runThinClient(() => { spawnDetachedBrowserServer(cliPath, process.cwd()); }).then(
    onThinClientDone,
    onThinClientError,
  );
} else if (isPerFile && target.kind === 'desktop') {
  const launcher = target.launcher;
  void runThinClient(
    () => { launchDetachedDesktopSession(launcher, process.cwd()); },
    DESKTOP_DISCOVER_TIMEOUT_MS,
  ).then(onThinClientDone, onThinClientError);
} else {
  runBlockingLaunch();
}
