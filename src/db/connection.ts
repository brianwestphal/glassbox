import { PGlite } from '@electric-sql/pglite';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

import { SCHEMA_AI_SQL,SCHEMA_CORE_SQL } from './schema.js';

let db: PGlite | null = null;
let currentDbPath: string | null = null;

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
  const dbDir = join(dataDir, 'data');
  mkdirSync(dbDir, { recursive: true });
  currentDbPath = join(dbDir, 'reviews');
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
    // PGLite WASM can abort on corrupt databases — offer recovery
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Aborted') || message.includes('RuntimeError')) {
      console.error('Database appears to be corrupt. Recreating...');
      console.error('(Previous review data will be lost.)');
      try {
        rmSync(currentDbPath, { recursive: true, force: true });
      } catch { /* may not exist */ }
      db = new PGlite(currentDbPath, DB_OPTIONS);
      await db.waitReady;
      await initSchema(db);
      return db;
    }
    throw err;
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
  await addColumnIfMissing(db, 'ai_file_scores', 'notes', 'TEXT');
  await addColumnIfMissing(db, 'ai_analyses', 'progress_completed', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'ai_analyses', 'progress_total', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'user_preferences', 'ignore_whitespace', 'BOOLEAN NOT NULL DEFAULT FALSE');
  await addColumnIfMissing(db, 'user_preferences', 'svg_view_mode', "TEXT NOT NULL DEFAULT 'code'");
  await addColumnIfMissing(db, 'user_preferences', 'last_image_mode', "TEXT NOT NULL DEFAULT 'metadata'");
  await addColumnIfMissing(db, 'user_preferences', 'scope_filter', "TEXT NOT NULL DEFAULT 'all'");

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
