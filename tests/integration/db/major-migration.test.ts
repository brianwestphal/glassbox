import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readClusterVersion } from 'pglite-migrate';
import { acquireEngine } from 'pglite-migrate/engines';
import { pathToFileURL } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDb, setDataDir } from '../../../src/db/connection.js';
import { SCHEMA_AI_SQL, SCHEMA_CORE_SQL } from '../../../src/db/ddl.js';

/**
 * A REAL PostgreSQL 17 -> 18 migration, driven through the application's own
 * `getDb()`.
 *
 * Gated, and deliberately not part of `npm test`: it reaches the npm registry to
 * download the ~25 MB PG17 engine and then boots two independent Postgres WASM
 * clusters. That is far too heavy and too network-dependent for the default
 * suite — the same reasoning that keeps the live-render plugin tests out of it.
 * The mocked unit coverage lives in tests/unit/db/migrate-major.test.ts.
 *
 * Run with: npm run test:live
 */
const live = process.env.GLASSBOX_LIVE_MIGRATION_TESTS === '1';

describe.skipIf(!live)('major-version migration (live PG17 -> PG18)', () => {
  let root: string;
  let dbPath: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'glassbox-migrate-'));
    dbPath = join(root, 'data', 'reviews');
    mkdirSync(join(root, 'data'), { recursive: true });

    // Build a genuine PG17 cluster the way an older Glassbox would have: the
    // app's schema, real rows, and — critically — WITHOUT a column that HEAD's
    // DDL has, so this reproduces the realistic "user is several schema versions
    // behind" case rather than a same-schema copy.
    const engine = await acquireEngine(17, { cache: 'keep' });
    const old = await import(pathToFileURL(engine.entry).href);
    const db = new old.PGlite(dbPath, { database: 'template1' });
    await db.waitReady;
    await db.exec(SCHEMA_CORE_SQL);
    await db.exec(SCHEMA_AI_SQL);
    await db.exec('ALTER TABLE review_files DROP COLUMN difference_score');
    for (let i = 0; i < 10; i++) {
      await db.exec(
        `INSERT INTO reviews (id, repo_path, repo_name, mode, status)
         VALUES ('r${String(i)}', '/repo/${String(i)}', 'repo${String(i)}', 'uncommitted', 'in_progress')`,
      );
      await db.exec(
        `INSERT INTO review_files (id, review_id, file_path, status)
         VALUES ('f${String(i)}', 'r${String(i)}', 'src/a${String(i)}.ts', 'pending')`,
      );
    }
    await db.exec(
      `INSERT INTO annotations (id, review_file_id, line_number, side, category, content)
       VALUES ('a1', 'f0', 12, 'new', 'bug', 'off-by-one'),
              ('a2', 'f1', 3, 'old', 'note', 'context ünïcode')`,
    );
    await db.close();

    expect(await readClusterVersion(dbPath)).toBe(17);
  }, 300_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('upgrades the cluster in place and preserves every row', async () => {
    setDataDir(root);

    const db = await getDb();

    expect(await readClusterVersion(dbPath)).toBe(18);
    const { rows } = await db.query<{ v: string }>('SELECT version() AS v');
    expect(rows[0].v).toContain('PostgreSQL 18');

    const counts = await db.query<{ reviews: number; files: number; annotations: number }>(
      `SELECT (SELECT count(*) FROM reviews)::int AS reviews,
              (SELECT count(*) FROM review_files)::int AS files,
              (SELECT count(*) FROM annotations)::int AS annotations`,
    );
    expect(counts.rows[0]).toEqual({ reviews: 10, files: 10, annotations: 2 });

    // Content, not just counts — including a non-ASCII body, since the transfer
    // goes through a COPY TEXT round trip.
    const ann = await db.query<{ content: string }>('SELECT content FROM annotations ORDER BY id');
    expect(ann.rows.map((r) => r.content)).toEqual(['off-by-one', 'context ünïcode']);

    // Foreign keys survived the transfer.
    const joined = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM reviews r JOIN review_files f ON f.review_id = r.id`,
    );
    expect(joined.rows[0].n).toBe(10);
  }, 300_000);

  it('brings the schema up to HEAD and stays writable', async () => {
    const db = await getDb();

    // The column the old cluster lacked must exist again: the staged target is
    // built by the app's own initSchema, so the migration and the normal schema
    // upgrade happen together rather than needing a second pass.
    const col = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'review_files' AND column_name = 'difference_score'`,
    );
    expect(col.rows).toHaveLength(1);

    await db.exec(
      `INSERT INTO reviews (id, repo_path, repo_name, mode, status)
       VALUES ('post-migration', '/p', 'post', 'uncommitted', 'in_progress')`,
    );
    await db.exec(
      `INSERT INTO review_files (id, review_id, file_path) VALUES ('pf', 'post-migration', 'b.ts')`,
    );
    await db.exec(`DELETE FROM reviews WHERE id = 'post-migration'`);
    const orphans = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM review_files WHERE review_id = 'post-migration'`,
    );
    expect(orphans.rows[0].n).toBe(0);
  }, 120_000);

  it('keeps exactly one backup of the original and leaves no staged directory', async () => {
    await getDb();

    const siblings = readdirSync(join(root, 'data')).filter((n) => n !== 'reviews');

    // One copy, not two: the pre-open backup is retained and the swap's own
    // displaced copy is dropped, so an upgrade does not double the disk cost.
    expect(siblings.filter((n) => n.includes('.bak-'))).toHaveLength(1);
    expect(siblings.filter((n) => n.includes('.old-'))).toHaveLength(0);
    expect(siblings.filter((n) => n.includes('.migrating-'))).toHaveLength(0);

    // The retained backup is the untouched PG17 original.
    const backup = siblings.find((n) => n.includes('.bak-'));
    expect(backup).toBeDefined();
    expect(await readClusterVersion(join(root, 'data', backup as string))).toBe(17);
    expect(existsSync(dbPath)).toBe(true);
  }, 120_000);
});
