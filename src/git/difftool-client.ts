/**
 * Thin-client side of the accumulating `git difftool` model (doc 19), used by
 * the per-file browser path of `glassbox-difftool` (`src/cli-difftool.ts`).
 *
 * Each per-file invocation: discover (or start) the singleton detached server,
 * append the file's already-read content over loopback HTTP, and either return
 * immediately or — on the final file — hold a connection open so `git difftool`
 * stays attached to the terminal (FR-19.3 / 19.4 / 19.5).
 *
 * All IO over `127.0.0.1` (FR-19.11). The pure decisions (last-file detection,
 * discovery parsing) live in `difftool-launch.ts` / `difftool-discovery.ts` so
 * they can be unit-tested; this file is the side-effecting glue.
 */
import { spawn } from 'node:child_process';

import { readDiscovery, tryAcquireStartingLock } from './difftool-discovery.js';

const DISCOVER_TIMEOUT_MS = 15 * 1000;
const PROBE_INTERVAL_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Probe a candidate server's readiness endpoint. Returns true only when it
 *  answers as a live difftool session. */
async function ping(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, 1000);
    const res = await fetch(`http://127.0.0.1:${port}/api/difftool/ping`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const json = (await res.json()) as { active?: boolean };
    return json.active === true;
  } catch {
    return false;
  }
}

function spawnDetachedServer(cliPath: string, cwd: string): void {
  const child = spawn(process.execPath, [cliPath, '--difftool-serve'], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/**
 * Find a running accumulating server or start one. Concurrent invocations
 * elect a single starter via the start lock; the rest poll until the started
 * server records its port and answers (FR-19.6, FR-19.12 — no dropped files).
 * Returns the server's port. Throws if no server becomes ready in time.
 */
export async function discoverOrStartServer(cliPath: string, cwd: string): Promise<number> {
  const deadline = Date.now() + DISCOVER_TIMEOUT_MS;
  let startedByUs = false;

  while (Date.now() < deadline) {
    const discovery = readDiscovery();
    if (discovery !== null && (await ping(discovery.port))) {
      return discovery.port;
    }
    // No live server yet. Exactly one invocation wins the election and starts
    // one; everyone else loops and waits for its port to appear.
    if (!startedByUs && tryAcquireStartingLock()) {
      startedByUs = true;
      spawnDetachedServer(cliPath, cwd);
    }
    await delay(PROBE_INTERVAL_MS);
  }
  throw new Error('glassbox-difftool: timed out waiting for the accumulating server to start');
}

/** Append one file's content to the active review. Throws on a non-OK response
 *  so a failure surfaces rather than silently dropping the file (FR-19.12). */
export async function appendFile(
  port: number,
  displayPath: string,
  oldContent: Buffer,
  newContent: Buffer,
): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/api/difftool/append`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: displayPath,
      oldContentB64: oldContent.toString('base64'),
      newContentB64: newContent.toString('base64'),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`glassbox-difftool: append failed (${String(res.status)}) ${detail}`);
  }
}

/**
 * Hold a connection open until the server ends the session (Done / tab close).
 * The held request keeps the wrapper alive — and thus `git difftool` attached
 * to the terminal (FR-19.5). Resolves when the server responds or the
 * connection drops; on Ctrl-C the process is terminated and the dropped socket
 * lets the server tear down.
 */
export async function holdUntilEnd(port: number): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/difftool/hold`);
  } catch {
    /* server closed the connection as it shut down — that's the end signal */
  }
}
