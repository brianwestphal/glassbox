import { PGlite } from '@electric-sql/pglite';
import { existsSync,mkdirSync, renameSync } from 'fs';
import { join } from 'path';

import { SCHEMA_AI_SQL,SCHEMA_CORE_SQL } from './ddl.js';
import { migrateMajorIfNeeded } from './migrate-major.js';

let db: PGlite | null = null;
let currentDbPath: string | null = null;
let currentDataDir: string | null = null;

// PGLite ≤0.3.x stored the working tables in the `template1` database (its
// historical default). PGLite 0.4.0 changed the default working database to
// `postgres` — so opening an existing pre-0.4 data directory with the default
// options connects to an empty `postgres` database and the user's reviews /
// annotations (which live in `template1`) appear to have vanished. Pinning the
// connection to `template1` keeps the storage location identical across the
// upgrade: existing data dirs open with their data intact, and freshly created
// dirs put their tables in the same place. Verified against a real pre-0.4
// data directory (61 reviews recovered) and a fresh-create + reopen round-trip.
const DB_OPTIONS = { database: 'template1' } as const;

export function setDataDir(dataDir: string) {
  currentDataDir = dataDir;
  const dbDir = join(dataDir, 'data');
  mkdirSync(dbDir, { recursive: true });
  currentDbPath = join(dbDir, 'reviews');
}

/** The active data directory (the parent of `data/`), or null before
 *  `setDataDir`. Used by the difftool blob store to locate where to persist the
 *  appended image bytes (GB-863). */
export function getDataDir(): string | null {
  return currentDataDir;
}

/** The review cluster's directory, or null before `setDataDir`. Retained
 *  pre-upgrade backups are siblings of it (doc 9 §9.1a). */
export function getDbPath(): string | null {
  return currentDbPath;
}

export async function getDb(): Promise<PGlite> {
  if (db) return db;
  if (currentDbPath === null) throw new Error('Data directory not set. Call setDataDir() first.');
  try {
    db = new PGlite(currentDbPath, DB_OPTIONS);
    await db.waitReady;
    await initSchema(db);
    return db;
  } catch (err: unknown) {
    db = null;
    // A directory written by an older Postgres major cannot be opened at all,
    // and the abort it produces is indistinguishable from real corruption by
    // message alone — PGlite reports it as a bare "failed to initialize
    // properly". So attempt the version migration *before* the corruption
    // recovery below, and only for a directory whose major actually differs;
    // it is a no-op in every other case.
    const migration = await migrateMajorIfNeeded(currentDbPath, initSchema);
    if (migration.status === 'migrated') {
      console.error(
        `Upgraded your database from PostgreSQL ${migration.fromMajor} to ${migration.toMajor} ` +
          `(${migration.rows} rows). A backup of the original is at: ${migration.backupPath}`
      );
      db = new PGlite(currentDbPath, DB_OPTIONS);
      await db.waitReady;
      await initSchema(db);
      return db;
    }
    if (migration.status === 'blocked') {
      // Deliberately fail to start rather than fall through to the recovery
      // path below. That path moves the directory aside and starts fresh, which
      // here would strand a perfectly good database: the canonical path would
      // then hold an empty cluster and no later launch would ever retry the
      // migration. Failing loudly keeps the data in place and self-heals once
      // the blocking condition (usually no network) clears.
      throw new Error(
        `Your database was created by PostgreSQL ${migration.fromMajor}, which this version of ` +
          `Glassbox cannot open directly. A one-time upgrade is needed and it could not be ` +
          `completed.\n\n` +
          `Reason: ${migration.reason}\n\n` +
          // Do not assert a cause here. An earlier version of this message
          // asserted "this most often means no network connection", which read
          // as a diagnosis; the first real-world failure was a schema mismatch,
          // so the message actively misdirected. State the reason and offer the
          // network only as one possibility.
          `Your data has not been modified. If the reason above mentions the network or the ` +
          `registry, reconnect and start Glassbox again — the upgrade downloads the older ` +
          `database engine once.`,
        { cause: err }
      );
    }

    // PGLite WASM can abort on corrupt databases — offer recovery
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Aborted') || message.includes('RuntimeError')) {
      // This branch used to `rmSync` the data directory, which destroyed every
      // review and annotation the user had. "The engine could not open it" is
      // not the same as "the bytes are worthless": the same abort is produced
      // by causes that are entirely recoverable — a half-written WAL, a file
      // locked by another process, or a data directory written by a different
      // Postgres major (PGlite has no pg_upgrade, so a future engine bump
      // cannot open today's directory at all). Deleting on that signal turns a
      // recoverable situation into permanent loss, so move it aside instead
      // and let the user — or a migration — still get at it.
      const result = quarantineDataDir(currentDbPath);
      if (!result.cleared) {
        // The old directory is still in place, so a fresh database cannot be
        // created over it. Fail loudly rather than fall back to deleting.
        throw err;
      }
      console.error('Database could not be opened. Starting a fresh one.');
      if (result.movedTo !== null) {
        console.error(`Your previous data has NOT been deleted — it is at: ${result.movedTo}`);
      }
      db = new PGlite(currentDbPath, DB_OPTIONS);
      await db.waitReady;
      await initSchema(db);
      return db;
    }
    throw err;
  }
}

/**
 * Outcome of trying to move an unopenable data directory aside. `cleared` means
 * the path is now free for a fresh database; `movedTo` is null only when there
 * was nothing there to move. `blocked` means the old directory is still in
 * place, so creating a fresh one over it must not be attempted.
 */
type QuarantineResult =
  | { cleared: true; movedTo: string | null }
  | { cleared: false };

/**
 * Move an unopenable data directory aside so a fresh one can be created in its
 * place without destroying the old bytes.
 *
 * @param dbPath - The data directory that could not be opened.
 * @returns Whether the path was cleared, and where the old directory went.
 */
export function quarantineDataDir(dbPath: string): QuarantineResult {
  if (!existsSync(dbPath)) return { cleared: true, movedTo: null };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantined = `${dbPath}.unreadable-${stamp}`;
  try {
    renameSync(dbPath, quarantined);
    return { cleared: true, movedTo: quarantined };
  } catch {
    return { cleared: false };
  }
}

async function initSchema(db: PGlite): Promise<void> {
  await db.exec(SCHEMA_CORE_SQL);
  await db.exec(SCHEMA_AI_SQL);

  // Migrations for existing databases — use safe column checks instead of
  // try/catch ALTER TABLE, since PGLite's WASM can abort on SQL errors
  // rather than throwing catchable exceptions.
  await addColumnIfMissing(db, 'reviews', 'head_commit', 'TEXT');
  await addColumnIfMissing(db, 'annotations', 'is_stale', 'BOOLEAN NOT NULL DEFAULT FALSE');
  await addColumnIfMissing(db, 'annotations', 'original_content', 'TEXT');
  await addColumnIfMissing(db, 'annotations', 'reply_to_note_id', 'TEXT');
  await addColumnIfMissing(db, 'annotations', 'region_data', 'TEXT');
  await addColumnIfMissing(db, 'review_files', 'difference_score', 'REAL');
  await addColumnIfMissing(db, 'ai_file_scores', 'notes', 'TEXT');
  await addColumnIfMissing(db, 'ai_analyses', 'progress_completed', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'ai_analyses', 'progress_total', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'user_preferences', 'ignore_whitespace', 'BOOLEAN NOT NULL DEFAULT FALSE');
  await addColumnIfMissing(db, 'user_preferences', 'svg_view_mode', "TEXT NOT NULL DEFAULT 'code'");
  await addColumnIfMissing(db, 'user_preferences', 'last_image_mode', "TEXT NOT NULL DEFAULT 'side-by-side'");
  await addColumnIfMissing(db, 'user_preferences', 'image_sxs_orientation', "TEXT NOT NULL DEFAULT 'left-right'");

  // Mark any 'running' analyses as failed — if the server is starting up,
  // no background workers exist to complete them (e.g. server was killed mid-analysis)
  await db.exec(
    `UPDATE ai_analyses SET status = 'failed', error_message = 'Interrupted (server restarted)' WHERE status = 'running'`
  );
}

async function addColumnIfMissing(db: PGlite, table: string, column: string, definition: string): Promise<void> {
  const result = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  if (result.rows.length === 0) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
