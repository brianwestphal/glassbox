import { execFileSync, spawn } from 'child_process';
import { resolve } from 'path';

import { debugLog } from '../debug.js';

/**
 * Platform-aware "open" helper.
 *
 * - `mode: 'url'` opens a URL (or any target) in the user's default handler:
 *   `open` (macOS) / `start` (Windows) / `xdg-open` (Linux). Synchronous; throws
 *   on spawn failure so the call site can swallow it.
 * - `mode: 'reveal'` opens the OS file browser focused on the given path:
 *   `open -R` (macOS Finder) / `explorer /select,PATH` (Windows) /
 *   `xdg-open <parent dir>` (Linux — no widely-supported "select" equivalent,
 *   so falls back to opening the containing directory). Launched detached and
 *   NON-BLOCKING: Windows `explorer.exe` does not return promptly to the
 *   spawning process, so a synchronous wait would hang the caller — and the HTTP
 *   request behind it. Reveal is best-effort, so spawn errors are swallowed.
 *
 * - `mode: 'edit'` opens the file in the user's editor. It prefers the
 *   `$VISUAL` / `$EDITOR` environment variable (spawned with the path as a
 *   separate argv, never shell-interpolated — doc 14 FR-14.3); when neither is
 *   set it falls back to the OS "open with the default application" handler.
 *   Launched detached / non-blocking like reveal. Note a terminal editor
 *   (e.g. `vim`) in `$EDITOR` can't be GUI-launched and will no-op.
 *
 * Both paths pass argv without shell interpolation (no `exec`), so a path or URL
 * containing spaces or shell metacharacters is safe.
 */
export function openOS(target: string, mode: 'url' | 'reveal' | 'edit'): void {
  if (mode === 'edit') {
    const editor = (process.env.VISUAL ?? process.env.EDITOR ?? '').trim();
    if (editor !== '') {
      // `$EDITOR` may carry flags (e.g. "code --wait"); split into argv and
      // append the path as a final separate argument — no shell interpolation.
      const parts = editor.split(/\s+/);
      const cmd = parts[0];
      if (cmd !== '') {
        launchDetached(cmd, [...parts.slice(1), target]);
        return;
      }
    }
    if (process.platform === 'darwin') {
      launchDetached('open', [target]);
    } else if (process.platform === 'win32') {
      launchDetached('cmd', ['/c', 'start', '', target]);
    } else {
      launchDetached('xdg-open', [target]);
    }
    return;
  }
  if (mode === 'reveal') {
    if (process.platform === 'darwin') {
      launchDetached('open', ['-R', target]);
    } else if (process.platform === 'win32') {
      // `explorer.exe /select,PATH` is documented Windows shell syntax: the
      // comma is a separator, not part of the path. `spawn` doesn't
      // shell-interpolate, so the joined string is passed verbatim as argv[1].
      launchDetached('explorer', ['/select,' + target]);
    } else {
      launchDetached('xdg-open', [resolve(target, '..')]);
    }
    return;
  }
  // mode === 'url'
  if (process.platform === 'darwin') {
    execFileSync('open', [target]);
  } else if (process.platform === 'win32') {
    // Windows `start` is a cmd builtin, not an exe — must go through cmd.
    execFileSync('cmd', ['/c', 'start', '', target]);
  } else {
    execFileSync('xdg-open', [target]);
  }
}

/**
 * Fire-and-forget child launch: returns immediately and never blocks the caller.
 * Used for "reveal in file manager", where the file-manager process — notably
 * Windows `explorer.exe` — may not hand control back to the spawner promptly. The
 * child is detached with no stdio and `unref`'d so it can outlive the request;
 * spawn errors are swallowed asynchronously (the action is best-effort).
 */
function launchDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    // Best-effort (command missing, etc.) — log under --debug so a broken
    // reveal isn't completely invisible.
    debugLog(`launchDetached(${command}) failed: ${err.message}`);
  });
  child.unref();
}
