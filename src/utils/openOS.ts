import { execFileSync } from 'child_process';
import { resolve } from 'path';

/**
 * Platform-aware "open" helper.
 *
 * - `mode: 'url'` opens a URL (or any target) in the user's default handler:
 *   `open` (macOS) / `start` (Windows) / `xdg-open` (Linux).
 * - `mode: 'reveal'` opens the OS file browser focused on the given path:
 *   `open -R` (macOS Finder) / `explorer /select,PATH` (Windows) /
 *   `xdg-open <parent dir>` (Linux — no widely-supported "select" equivalent,
 *   so falls back to opening the containing directory).
 *
 * Uses `execFileSync` (not `exec`) so argv is passed without shell
 * interpolation. Throws on spawn failure; the call site decides whether
 * to swallow (e.g. reveal for a not-yet-existing added file is best-effort).
 */
export function openOS(target: string, mode: 'url' | 'reveal'): void {
  if (mode === 'reveal') {
    if (process.platform === 'darwin') {
      execFileSync('open', ['-R', target]);
    } else if (process.platform === 'win32') {
      // `explorer.exe /select,PATH` is documented Windows shell syntax: the
      // comma is a separator, not part of the path. `execFileSync` doesn't
      // shell-interpolate, so the joined string is passed verbatim as argv[1].
      execFileSync('explorer', ['/select,' + target]);
    } else {
      execFileSync('xdg-open', [resolve(target, '..')]);
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
