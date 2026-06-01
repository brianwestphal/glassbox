/**
 * `glassbox-difftool` — git-difftool bridge for Glassbox.
 *
 * Invoked as `git difftool --dir-diff <refA> <refB>` via:
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
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length < 2 || args[0].startsWith('-') || args[1].startsWith('-')) {
  console.error('usage: glassbox-difftool <local-dir> <remote-dir> [extra glassbox args...]');
  console.error('');
  console.error('Configure as a git difftool:');
  console.error('  git config --global diff.tool glassbox');
  console.error("  git config --global difftool.glassbox.cmd 'glassbox-difftool \"$LOCAL\" \"$REMOTE\"'");
  console.error('  git config --global difftool.prompt false');
  console.error('');
  console.error('Then use `--dir-diff` (per-file mode collides with Glassbox\'s instance lock):');
  console.error('  git difftool --dir-diff HEAD~1 HEAD');
  process.exit(1);
}

const [local, remote, ...extra] = args;

// One temp tree per invocation, removed on exit. The dereferenced copies
// land at <work>/left and <work>/right — Glassbox treats those as the two
// roots of a folder-vs-folder review and labels the session "left ↔ right".
const work = mkdtempSync(join(tmpdir(), 'glassbox-difftool-'));
const resolvedLocal = join(work, 'left');
const resolvedRemote = join(work, 'right');

function cleanup(): void {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// If the wrapper is killed mid-flight (Ctrl-C, etc.), still try to drop the
// temp tree. spawnSync below propagates signals to the child, so the wrapper
// usually exits via the finally below; these handlers cover edge cases.
const signalExit = (code: number) => () => { cleanup(); process.exit(code); };
process.on('SIGINT', signalExit(130));
process.on('SIGTERM', signalExit(143));

try {
  // `dereference: true` follows symlinks and copies the resolved content.
  // This is the whole point of the wrapper.
  cpSync(local, resolvedLocal, { recursive: true, dereference: true });
  cpSync(remote, resolvedRemote, { recursive: true, dereference: true });

  // Locate the bundled `glassbox` CLI. tsup writes both `cli.js` and this
  // file (`cli-difftool.js`) into `dist/` as siblings, so `cli.js` lives at
  // `<this-file's-dir>/cli.js`.
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = join(here, 'cli.js');

  const res = spawnSync(process.execPath, [cli, '--diff', resolvedLocal, resolvedRemote, ...extra], {
    stdio: 'inherit',
  });
  process.exit(res.status ?? 0);
} finally {
  cleanup();
}
