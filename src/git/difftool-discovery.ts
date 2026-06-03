/**
 * Discovery of the singleton accumulating `git difftool` server (doc 19,
 * FR-19.6). The wrapper and the detached server rendezvous through two files in
 * the user's `~/.glassbox` home:
 *
 *  - **`difftool.lock`** — the running server records its port here. The
 *    wrapper reads it to find a server to append to.
 *  - **`difftool-starting.lock`** — a short-lived election marker. When no
 *    server is found, exactly one concurrent wrapper invocation wins this lock
 *    and starts the detached server; the others wait for the port to appear,
 *    so a multi-file `git difftool` burst doesn't race into N servers
 *    (FR-19.12 — no dropped files).
 *
 * Parsing is split out as a pure function so the malformed-file handling can be
 * unit-tested without touching the filesystem.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

const DiscoverySchema = z.object({
  port: z.number().int().positive(),
  pid: z.number().int().optional(),
});
export type Discovery = z.infer<typeof DiscoverySchema>;

/** A starting-lock older than this is treated as stale (its owner died before
 *  recording a port) and may be stolen, so a crashed starter can't wedge the
 *  feature permanently. */
const STARTING_LOCK_STALE_MS = 30 * 1000;

export function difftoolHome(): string {
  return join(homedir(), '.glassbox');
}

export function discoveryPath(home: string = difftoolHome()): string {
  return join(home, 'difftool.lock');
}

export function startingLockPath(home: string = difftoolHome()): string {
  return join(home, 'difftool-starting.lock');
}

/**
 * Pure parse of a discovery lockfile's raw JSON contents. Returns `null` for
 * malformed JSON or a shape missing the port, so a corrupt file is treated the
 * same as "no server recorded".
 */
export function parseDiscovery(raw: string): Discovery | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = DiscoverySchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function readDiscovery(home: string = difftoolHome()): Discovery | null {
  const path = discoveryPath(home);
  if (!existsSync(path)) return null;
  try {
    return parseDiscovery(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeDiscovery(port: number, home: string = difftoolHome()): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(discoveryPath(home), JSON.stringify({ port, pid: process.pid }));
}

export function clearDiscovery(home: string = difftoolHome()): void {
  try { rmSync(discoveryPath(home), { force: true }); } catch { /* best-effort */ }
}

/**
 * Try to win the start-the-server election. Returns `true` for exactly one
 * caller via an exclusive (`wx`) create; everyone else gets `false` and should
 * wait for the port to appear. A stale lock (owner died before writing the
 * port) is stolen so the feature can recover.
 */
export function tryAcquireStartingLock(home: string = difftoolHome()): boolean {
  mkdirSync(home, { recursive: true });
  const path = startingLockPath(home);
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    try {
      const ageMs = Date.now() - statSync(path).mtimeMs;
      if (ageMs > STARTING_LOCK_STALE_MS) {
        rmSync(path, { force: true });
        writeFileSync(path, String(process.pid), { flag: 'wx' });
        return true;
      }
    } catch {
      /* another invocation recreated/removed it between our checks — let them start it */
    }
    return false;
  }
}

export function releaseStartingLock(home: string = difftoolHome()): void {
  try { rmSync(startingLockPath(home), { force: true }); } catch { /* best-effort */ }
}
