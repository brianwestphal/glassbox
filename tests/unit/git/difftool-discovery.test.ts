import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearDiscovery,
  parseDiscovery,
  readDiscovery,
  releaseStartingLock,
  startingLockPath,
  tryAcquireStartingLock,
  writeDiscovery,
} from '../../../src/git/difftool-discovery.js';

// doc 19, FR-19.6 / 19.12 — discovery + the start-election lock that keeps a
// multi-file `git difftool` burst from racing into N servers.

describe('parseDiscovery (pure)', () => {
  it('parses a valid discovery file', () => {
    expect(parseDiscovery('{"port":4183,"pid":123}')).toEqual({ port: 4183, pid: 123 });
  });

  it('accepts a port-only file', () => {
    expect(parseDiscovery('{"port":5000}')).toEqual({ port: 5000 });
  });

  it('returns null for malformed JSON', () => {
    expect(parseDiscovery('not json')).toBeNull();
    expect(parseDiscovery('')).toBeNull();
  });

  it('returns null when the port is missing or invalid', () => {
    expect(parseDiscovery('{"pid":1}')).toBeNull();
    expect(parseDiscovery('{"port":-1}')).toBeNull();
    expect(parseDiscovery('{"port":"4183"}')).toBeNull();
  });
});

describe('discovery + starting-lock IO', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'glassbox-discovery-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('round-trips a written port', () => {
    expect(readDiscovery(home)).toBeNull();
    writeDiscovery(7777, home);
    expect(readDiscovery(home)?.port).toBe(7777);
    clearDiscovery(home);
    expect(readDiscovery(home)).toBeNull();
  });

  it('treats a corrupt discovery file as no server', () => {
    writeDiscovery(7777, home);
    // Corrupt it.
    const path = join(home, 'difftool.lock');
    writeFileSync(path, 'garbage');
    expect(readDiscovery(home)).toBeNull();
  });

  it('grants the starting lock to exactly one of two contenders', () => {
    expect(tryAcquireStartingLock(home)).toBe(true);
    expect(existsSync(startingLockPath(home))).toBe(true);
    // A second concurrent invocation must NOT also win it.
    expect(tryAcquireStartingLock(home)).toBe(false);
    // Once released, it can be re-acquired.
    releaseStartingLock(home);
    expect(tryAcquireStartingLock(home)).toBe(true);
  });

  it('records the holder pid in the lock', () => {
    tryAcquireStartingLock(home);
    expect(readFileSync(startingLockPath(home), 'utf-8')).toBe(String(process.pid));
  });
});
