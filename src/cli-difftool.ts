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
 *    before the next. In a **browser** install this wrapper is a thin client
 *    (doc 19): it reads the two files' content, forwards them to a single
 *    long-lived accumulating server, and returns at once so all files pile into
 *    one review/tab. See `git/difftool-client.ts`. In a **desktop** install the
 *    per-file path still uses the blocking one-window-per-file launch below
 *    (single-window desktop accumulation is tracked separately).
 *
 * Desktop vs browser
 * ------------------
 * When this wrapper runs from a desktop bundle it delegates to the bundled
 * `glassbox` launcher shim so the review opens in the Tauri window — matching
 * what `glassbox --commit` does from the same folder. From an `npm install` it
 * runs `cli.js` directly (browser); per-file browser mode goes through the
 * accumulating thin client, while `--dir-diff` and desktop launches stay
 * blocking so the dereferenced temp tree survives for the whole session.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendFile, discoverOrStartServer, holdUntilEnd } from './git/difftool-client.js';
import { DIFFTOOL_BLOCK_ENV, planSnapshot, resolveLaunchTarget, shouldHoldForSession } from './git/difftool-launch.js';

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

// `--dir-diff` hands us directories; per-file mode hands us single files.
let localIsFile = false;
try { localIsFile = statSync(local).isFile(); } catch { /* treat as dir */ }

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
 * Browser per-file accumulating path (doc 19): read both sides NOW (git deletes
 * the temp files the instant we exit), forward to the singleton server, and
 * return immediately — except on the final file, where we hold so `git difftool`
 * stays attached until the user clicks "Done" or closes the tab.
 */
async function runThinClient(cliPath: string): Promise<void> {
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

  const port = await discoverOrStartServer(cliPath, process.cwd());
  await appendFile(port, displayPath, oldContent, newContent);
  if (shouldHoldForSession(process.env)) {
    await holdUntilEnd(port);
  }
}

/**
 * Blocking launch for `--dir-diff` (any target) and per-file desktop: build the
 * dereferenced temp tree and hand the two roots to `glassbox --diff`. The launch
 * blocks for the whole session, keeping the temp tree alive and sequencing
 * per-file desktop one file at a time.
 */
function runBlockingLaunch(): never {
  // `planSnapshot` preserves the filename in the per-file case so the review
  // isn't labeled "left ↔ right".
  const work = mkdtempSync(join(tmpdir(), 'glassbox-difftool-'));
  const plan = planSnapshot(local, remote, work, localIsFile, basename);

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

if (localIsFile && target.kind === 'browser') {
  runThinClient(target.cli).then(
    () => { process.exit(0); },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
} else {
  runBlockingLaunch();
}
