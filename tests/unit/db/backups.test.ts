import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deleteDatabaseBackup, listDatabaseBackups } from '../../../src/db/backups.js';

let root: string;
let dbPath: string;

/** Create a directory under the data dir with a file of `size` bytes in it. */
function makeDir(name: string, size = 0): string {
  const path = join(root, 'data', name);
  mkdirSync(path, { recursive: true });
  if (size > 0) writeFileSync(join(path, 'base'), Buffer.alloc(size));
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'glassbox-backups-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  dbPath = join(root, 'data', 'reviews');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listDatabaseBackups', () => {
  it('returns nothing when the data directory does not exist', () => {
    expect(listDatabaseBackups(join(root, 'nope', 'reviews'))).toEqual([]);
  });

  it('returns nothing when there are no backups', () => {
    makeDir('reviews', 100);

    expect(listDatabaseBackups(dbPath)).toEqual([]);
  });

  it('reports a backup with its size and parsed timestamp', () => {
    makeDir('reviews', 10);
    makeDir('reviews.bak-2026-08-03T04-04-05-853Z', 2048);

    const [backup, ...rest] = listDatabaseBackups(dbPath);

    expect(rest).toHaveLength(0);
    expect(backup.name).toBe('reviews.bak-2026-08-03T04-04-05-853Z');
    expect(backup.bytes).toBe(2048);
    // The suffix substitutes `:` and `.` with `-`, which is not reversible by a
    // plain swap — the date's own hyphens look identical to the substituted
    // ones — so this pins that the fixed-shape parse recovers the real instant.
    expect(backup.createdAt).toBe('2026-08-03T04:04:05.853Z');
  });

  it('sums sizes recursively', () => {
    const backup = makeDir('reviews.bak-2026-08-03T04-04-05-853Z', 100);
    mkdirSync(join(backup, 'pg_wal'), { recursive: true });
    writeFileSync(join(backup, 'pg_wal', 'seg'), Buffer.alloc(400));

    expect(listDatabaseBackups(dbPath)[0].bytes).toBe(500);
  });

  it('orders newest first', () => {
    makeDir('reviews.bak-2026-01-01T00-00-00-000Z');
    makeDir('reviews.bak-2026-08-03T04-04-05-853Z');
    makeDir('reviews.bak-2026-05-05T00-00-00-000Z');

    expect(listDatabaseBackups(dbPath).map(b => b.createdAt)).toEqual([
      '2026-08-03T04:04:05.853Z',
      '2026-05-05T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
  });

  it('reports an unparseable suffix as a backup with no date', () => {
    // Better to list it with a vaguer label than to hide a directory that is
    // genuinely occupying disk.
    makeDir('reviews.bak-whenever', 64);

    const [backup] = listDatabaseBackups(dbPath);
    expect(backup.name).toBe('reviews.bak-whenever');
    expect(backup.createdAt).toBeNull();
    expect(backup.bytes).toBe(64);
  });

  it('ignores the quarantined unreadable directories', () => {
    // `reviews.unreadable-<ts>` (doc 9 §9.5) looks similar and is equally
    // permanent, but it can be the user's ONLY copy of data that never
    // migrated. Offering a one-click delete for it would be a different and
    // much riskier feature, so it must not appear here.
    makeDir('reviews.unreadable-2026-08-03T04-04-05-853Z', 999);
    makeDir('reviews.bak-2026-08-03T04-04-05-853Z', 10);

    expect(listDatabaseBackups(dbPath).map(b => b.name)).toEqual([
      'reviews.bak-2026-08-03T04-04-05-853Z',
    ]);
  });

  it('ignores unrelated siblings, including the live cluster', () => {
    makeDir('reviews', 10);
    makeDir('reviews.migrating-2026-08-03T04-04-05-853Z', 10);
    makeDir('attachments', 10);

    expect(listDatabaseBackups(dbPath)).toEqual([]);
  });
});

describe('deleteDatabaseBackup', () => {
  it('removes a real backup and reports success', () => {
    const path = makeDir('reviews.bak-2026-08-03T04-04-05-853Z', 32);

    expect(deleteDatabaseBackup(dbPath, 'reviews.bak-2026-08-03T04-04-05-853Z')).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('leaves other backups alone', () => {
    makeDir('reviews.bak-2026-01-01T00-00-00-000Z');
    const keep = makeDir('reviews.bak-2026-08-03T04-04-05-853Z');

    deleteDatabaseBackup(dbPath, 'reviews.bak-2026-01-01T00-00-00-000Z');

    expect(existsSync(keep)).toBe(true);
  });

  it('reports false for a name that does not exist', () => {
    expect(deleteDatabaseBackup(dbPath, 'reviews.bak-2026-08-03T04-04-05-853Z')).toBe(false);
  });

  // The safety property: this deletes recursively, so it must be impossible to
  // aim at anything but a backup. Each case below would be destructive.
  it.each([
    ['the live cluster', 'reviews'],
    ['a quarantined unreadable directory', 'reviews.unreadable-2026-08-03T04-04-05-853Z'],
    ['a staged migration directory', 'reviews.migrating-2026-08-03T04-04-05-853Z'],
    ['an unrelated sibling', 'attachments'],
  ])('refuses to delete %s', (_label, name) => {
    const path = makeDir(name, 16);

    expect(deleteDatabaseBackup(dbPath, name)).toBe(false);
    expect(existsSync(path)).toBe(true);
  });

  // Traversal. These names are chosen so that `join` actually RESOLVES onto a
  // real directory outside the data dir — an earlier version of this test used
  // `reviews.bak-../../escape`, which normalizes to `<data>/escape` and so
  // passed even with the guard removed, proving nothing. Each name below lands
  // on a directory that exists, so the assertion has something to protect.
  it.each([
    ['escapes the data directory', 'reviews.bak-a/../../escape', (r: string) => join(r, 'escape')],
    ['escapes to the live cluster', 'reviews.bak-a/../reviews', (r: string) => join(r, 'data', 'reviews')],
    ['a parent reference', '../escape', (r: string) => join(r, 'escape')],
  ])('refuses a name that %s', (_label, name, target) => {
    mkdirSync(join(root, 'escape'), { recursive: true });
    makeDir('reviews', 8);
    const victim = target(root);
    expect(existsSync(victim)).toBe(true); // the guard has something to defend

    expect(deleteDatabaseBackup(dbPath, name)).toBe(false);
    expect(existsSync(victim)).toBe(true);
  });

  it('refuses a nested path even when it stays inside the data directory', () => {
    const nested = join(root, 'data', 'reviews.bak-x', 'nested');
    mkdirSync(nested, { recursive: true });

    expect(deleteDatabaseBackup(dbPath, 'reviews.bak-x/nested')).toBe(false);
    expect(existsSync(nested)).toBe(true);
  });

  it('refuses a file that merely has the backup prefix', () => {
    // Only whole clusters are ever backups; a stray file matching the prefix
    // should not be silently removed by a "delete backup" action.
    const path = join(root, 'data', 'reviews.bak-2026-08-03T04-04-05-853Z');
    writeFileSync(path, 'not a directory');

    expect(deleteDatabaseBackup(dbPath, 'reviews.bak-2026-08-03T04-04-05-853Z')).toBe(false);
    expect(existsSync(path)).toBe(true);
  });
});
