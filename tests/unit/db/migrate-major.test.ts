import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module under test orchestrates pglite-migrate and the filesystem; both are
// mocked here so every branch — including the ones that only happen when a
// migration fails partway — can be driven deterministically. The real PG17->PG18
// round trip is covered by tests/integration/db/major-migration.test.ts.
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
}));

// `vi.mock` is hoisted above every top-level statement, so the constructor it
// returns has to be created inside `vi.hoisted` — a plain `const` above would
// still be in its temporal dead zone when the factory runs.
const { mockPGlite } = vi.hoisted(() => ({
  mockPGlite: vi.fn(function (this: any, _dataDir: string, _options?: unknown) {
    this.waitReady = Promise.resolve();
    this.exec = vi.fn().mockResolvedValue(undefined);
    this.query = vi.fn().mockResolvedValue({ rows: [] });
    this.close = vi.fn().mockResolvedValue(undefined);
  }),
}));
vi.mock('@electric-sql/pglite', () => ({ PGlite: mockPGlite }));

const mocks = {
  readClusterVersion: vi.fn(),
  backupDataDir: vi.fn(),
  openDataDir: vi.fn(),
  migrate: vi.fn(),
  introspectSchema: vi.fn(),
  validateMigration: vi.fn(),
  swapIntoPlace: vi.fn(),
  acquireEngine: vi.fn(),
};
vi.mock('pglite-migrate', () => ({
  readClusterVersion: (...a: unknown[]) => mocks.readClusterVersion(...a),
  backupDataDir: (...a: unknown[]) => mocks.backupDataDir(...a),
  openDataDir: (...a: unknown[]) => mocks.openDataDir(...a),
  migrate: (...a: unknown[]) => mocks.migrate(...a),
  introspectSchema: (...a: unknown[]) => mocks.introspectSchema(...a),
  validateMigration: (...a: unknown[]) => mocks.validateMigration(...a),
  swapIntoPlace: (...a: unknown[]) => mocks.swapIntoPlace(...a),
}));
vi.mock('pglite-migrate/engines', () => ({
  acquireEngine: (...a: unknown[]) => mocks.acquireEngine(...a),
}));

import { existsSync, rmSync } from 'fs';

import { migrateMajorIfNeeded } from '../../../src/db/migrate-major.js';

const DB_PATH = '/data/reviews';
const initSchema = vi.fn().mockResolvedValue(undefined);

/** Wire up the happy path: a PG17 directory, a PG18 engine, a clean migration. */
function happyPath() {
  vi.mocked(existsSync).mockReturnValue(true);
  // First call reads the source directory, second reads the freshly staged one.
  mocks.readClusterVersion.mockResolvedValueOnce(17).mockResolvedValueOnce(18);
  mocks.acquireEngine.mockResolvedValue({
    entry: '/cache/pglite-0.4.6/dist/index.js',
    release: { version: '0.4.6' },
    cleanup: vi.fn().mockResolvedValue(undefined),
  });
  mocks.backupDataDir.mockResolvedValue('/data/reviews.bak-2026');
  mocks.openDataDir.mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) });
  mocks.migrate.mockResolvedValue({ tables: [{ rowsCopied: 40 }, { rowsCopied: 2 }] });
  mocks.introspectSchema.mockResolvedValue({ tables: [] });
  mocks.validateMigration.mockResolvedValue({ ok: true, tables: [] });
  mocks.swapIntoPlace.mockResolvedValue({ canonical: DB_PATH, previous: null });
}

describe('migrateMajorIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const m of Object.values(mocks)) m.mockReset();
  });

  it('does nothing when there is no data directory', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(await migrateMajorIfNeeded(DB_PATH, initSchema)).toEqual({ status: 'not-needed' });
    expect(mocks.acquireEngine).not.toHaveBeenCalled();
  });

  it('does nothing when the directory has no readable PG_VERSION', async () => {
    // Not a recognizable cluster at all — that is corruption, and misreading it
    // as a version gap would send a genuinely broken directory down the
    // migration path instead of the caller's recovery path.
    vi.mocked(existsSync).mockReturnValue(true);
    mocks.readClusterVersion.mockRejectedValue(new Error('ENOENT'));

    expect(await migrateMajorIfNeeded(DB_PATH, initSchema)).toEqual({ status: 'not-needed' });
    expect(mocks.acquireEngine).not.toHaveBeenCalled();
  });

  it('does nothing when the directory is already at the running major', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    mocks.readClusterVersion.mockResolvedValueOnce(18).mockResolvedValueOnce(18);

    expect(await migrateMajorIfNeeded(DB_PATH, initSchema)).toEqual({ status: 'not-needed' });
    // No engine download and no backup for a directory that needs neither.
    expect(mocks.acquireEngine).not.toHaveBeenCalled();
    expect(mocks.backupDataDir).not.toHaveBeenCalled();
    // The staged probe directory must not be left behind.
    expect(rmSync).toHaveBeenCalledWith(expect.stringContaining('.migrating-'), expect.anything());
  });

  it('migrates a PG17 directory and reports what it moved', async () => {
    happyPath();

    const result = await migrateMajorIfNeeded(DB_PATH, initSchema);

    expect(result).toEqual({
      status: 'migrated',
      fromMajor: 17,
      toMajor: 18,
      rows: 42,
      backupPath: '/data/reviews.bak-2026',
    });
  });

  it('opens the source with the acquired old engine, not the installed one', async () => {
    happyPath();

    await migrateMajorIfNeeded(DB_PATH, initSchema);

    // openDataDir prefers an *installed* engine, and the installed one here is
    // the new major that cannot read this directory. Naming the acquired
    // engine's entry path explicitly is what forces the old one to be used.
    expect(mocks.acquireEngine).toHaveBeenCalledWith(17, { cache: 'ephemeral' });
    expect(mocks.openDataDir).toHaveBeenCalledWith(
      DB_PATH,
      '/cache/pglite-0.4.6/dist/index.js',
      { pgliteOptions: { database: 'template1' } },
    );
  });

  it('pins template1 on the staged target too', async () => {
    happyPath();

    await migrateMajorIfNeeded(DB_PATH, initSchema);

    // Both clusters must agree on where the tables live, or the migrated
    // directory would be unreadable by the app's own connection options.
    for (const call of mockPGlite.mock.calls) {
      expect(call[1]).toEqual({ database: 'template1' });
      expect(call[0]).toContain('.migrating-');
    }
  });

  it('backs up before the old engine ever opens the directory', async () => {
    happyPath();

    await migrateMajorIfNeeded(DB_PATH, initSchema);

    // Opening a cluster can write to it (WAL replay, recovery), so a backup
    // taken afterwards would not be a copy of what the user actually had.
    const backupOrder = mocks.backupDataDir.mock.invocationCallOrder[0];
    const openOrder = mocks.openDataDir.mock.invocationCallOrder[0];
    expect(backupOrder).toBeLessThan(openOrder);
  });

  it('swaps only after validation passes, and drops the redundant displaced copy', async () => {
    happyPath();

    await migrateMajorIfNeeded(DB_PATH, initSchema);

    const validateOrder = mocks.validateMigration.mock.invocationCallOrder[0];
    const swapOrder = mocks.swapIntoPlace.mock.invocationCallOrder[0];
    expect(validateOrder).toBeLessThan(swapOrder);
    // The pre-open backup is the better copy; keeping the swap's one too would
    // leave two full-size duplicates on disk after every upgrade.
    expect(mocks.swapIntoPlace).toHaveBeenCalledWith(DB_PATH, expect.stringContaining('.migrating-'), {
      keepOld: false,
    });
  });

  it('never swaps when validation fails, and reports the offending tables', async () => {
    happyPath();
    mocks.validateMigration.mockResolvedValue({
      ok: false,
      tables: [{ table: 'public.reviews', ok: false }, { table: 'public.annotations', ok: true }],
    });

    const result = await migrateMajorIfNeeded(DB_PATH, initSchema);

    expect(result.status).toBe('blocked');
    expect(result).toMatchObject({ fromMajor: 17 });
    expect((result as { reason: string }).reason).toContain('public.reviews');
    // This is the whole safety property: a bad migration must not reach the
    // canonical directory.
    expect(mocks.swapIntoPlace).not.toHaveBeenCalled();
  });

  it.each([
    ['the old engine cannot be downloaded', () => mocks.acquireEngine.mockRejectedValue(new Error('offline'))],
    ['the transfer itself fails', () => mocks.migrate.mockRejectedValue(new Error('COPY blew up'))],
    ['the swap fails', () => mocks.swapIntoPlace.mockRejectedValue(new Error('EXDEV'))],
  ])('reports blocked and leaves the canonical directory alone when %s', async (_label, breakIt) => {
    happyPath();
    breakIt();

    const result = await migrateMajorIfNeeded(DB_PATH, initSchema);

    expect(result.status).toBe('blocked');
    // Only the staged sibling is ever removed — never the user's data.
    for (const call of vi.mocked(rmSync).mock.calls) {
      expect(call[0]).toContain('.migrating-');
    }
  });

  it('releases the downloaded engine even when the migration fails', async () => {
    happyPath();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    mocks.acquireEngine.mockResolvedValue({
      entry: '/cache/e/index.js',
      release: { version: '0.4.6' },
      cleanup,
    });
    mocks.migrate.mockRejectedValue(new Error('boom'));

    await migrateMajorIfNeeded(DB_PATH, initSchema);

    // Otherwise a failed upgrade would strand ~25 MB in the cache on every run.
    expect(cleanup).toHaveBeenCalled();
  });

  it('closes both clusters when the migration fails partway', async () => {
    happyPath();
    const sourceClose = vi.fn().mockResolvedValue(undefined);
    mocks.openDataDir.mockResolvedValue({ close: sourceClose });
    mocks.migrate.mockRejectedValue(new Error('boom'));

    await migrateMajorIfNeeded(DB_PATH, initSchema);

    // A leaked engine holds the directory open, which would break the retry on
    // the next launch as well as this run.
    expect(sourceClose).toHaveBeenCalled();
    const target = mockPGlite.mock.instances.at(-1) as { close: ReturnType<typeof vi.fn> };
    expect(target.close).toHaveBeenCalled();
  });
});
