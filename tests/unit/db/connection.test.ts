import { join } from 'path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock schema
vi.mock('../../../src/db/ddl.js', () => ({
  SCHEMA_CORE_SQL: 'CREATE TABLE IF NOT EXISTS reviews();',
  SCHEMA_AI_SQL: 'CREATE TABLE IF NOT EXISTS ai_analyses();',
}));

// Create a mock PGlite instance
function createMockPGlite() {
  return {
    waitReady: Promise.resolve(),
    exec: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [] }),
  };
}

// Use a function (not arrow) so it can be called with `new`
const mockPGliteConstructor = vi.fn(function (this: any, _path: string) {
  const mock = createMockPGlite();
  Object.assign(this, mock);
  this.waitReady = mock.waitReady;
  this.exec = mock.exec;
  this.query = mock.query;
});

vi.mock('@electric-sql/pglite', () => ({
  PGlite: mockPGliteConstructor,
}));

import { mkdirSync } from 'fs';

const mockMkdirSync = vi.mocked(mkdirSync);

describe('connection', () => {
  beforeEach(() => {
    vi.resetModules();
    mockMkdirSync.mockClear();
    mockPGliteConstructor.mockClear();
  });

  it('setDataDir creates data directory and sets db path', async () => {
    const { setDataDir } = await import('../../../src/db/connection.js');
    setDataDir('/tmp/test-glassbox');

    expect(mockMkdirSync).toHaveBeenCalledWith(join('/tmp/test-glassbox', 'data'), { recursive: true });
  });

  it('getDb throws if setDataDir was not called', async () => {
    const { getDb } = await import('../../../src/db/connection.js');

    await expect(getDb()).rejects.toThrow('Data directory not set');
  });

  it('getDb creates PGlite with correct path and pins the template1 database', async () => {
    const { setDataDir, getDb } = await import('../../../src/db/connection.js');
    setDataDir('/tmp/test-glassbox');

    await getDb();

    // The `database: 'template1'` option is load-bearing: PGLite 0.4.0 changed
    // the default working database from `template1` to `postgres`, so without
    // this option an existing pre-0.4 data dir would open an empty `postgres`
    // database and the user's reviews would appear to vanish. Guard against a
    // regression that drops it.
    expect(mockPGliteConstructor).toHaveBeenCalledWith(
      join('/tmp/test-glassbox', 'data', 'reviews'),
      { database: 'template1' },
    );
  });

  it('getDb runs schema SQL', async () => {
    const { setDataDir, getDb } = await import('../../../src/db/connection.js');
    setDataDir('/tmp/test-glassbox');

    const db = await getDb();

    expect(db.exec).toHaveBeenCalledWith('CREATE TABLE IF NOT EXISTS reviews();');
    expect(db.exec).toHaveBeenCalledWith('CREATE TABLE IF NOT EXISTS ai_analyses();');
  });

  it('getDb returns same instance on subsequent calls (singleton)', async () => {
    const { setDataDir, getDb } = await import('../../../src/db/connection.js');
    setDataDir('/tmp/test-glassbox');

    const db1 = await getDb();
    const db2 = await getDb();

    expect(db1).toBe(db2);
    expect(mockPGliteConstructor).toHaveBeenCalledTimes(1);
  });

  it('getDb runs migration column checks', async () => {
    const { setDataDir, getDb } = await import('../../../src/db/connection.js');
    setDataDir('/tmp/test-glassbox');

    const db = await getDb();

    expect(db.query).toHaveBeenCalled();
    const queryCalls = (db.query as any).mock.calls;
    const columnChecks = queryCalls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('information_schema.columns')
    );
    expect(columnChecks.length).toBeGreaterThan(0);
  });

  it('getDb adds missing columns when they do not exist', async () => {
    const { setDataDir, getDb } = await import('../../../src/db/connection.js');
    setDataDir('/tmp/test-glassbox');

    const db = await getDb();

    const execCalls = (db.exec as any).mock.calls.map((c: any[]) => c[0] as string);
    const alterCalls = execCalls.filter((sql: string) => sql.includes('ALTER TABLE'));
    expect(alterCalls.length).toBeGreaterThan(0);
    expect(alterCalls.some((sql: string) => sql.includes('head_commit'))).toBe(true);
    expect(alterCalls.some((sql: string) => sql.includes('is_stale'))).toBe(true);
  });

  it('getDb resets running analyses to failed on startup', async () => {
    const { setDataDir, getDb } = await import('../../../src/db/connection.js');
    setDataDir('/tmp/test-glassbox');

    const db = await getDb();

    const execCalls = (db.exec as any).mock.calls.map((c: any[]) => c[0] as string);
    const resetCall = execCalls.find(
      (sql: string) => sql.includes('UPDATE ai_analyses') && sql.includes("status = 'failed'")
    );
    expect(resetCall).toBeDefined();
  });
});
