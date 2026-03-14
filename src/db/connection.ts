import { PGlite } from '@electric-sql/pglite';
import { mkdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { SCHEMA_CORE_SQL, SCHEMA_AI_SQL } from './schema.js';

const dataDir = join(homedir(), '.glassbox', 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = join(dataDir, 'reviews');

let db: PGlite | null = null;

export async function getDb(): Promise<PGlite> {
  if (db) return db;
  try {
    db = new PGlite(dbPath);
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
        rmSync(dbPath, { recursive: true, force: true });
      } catch { /* may not exist */ }
      db = new PGlite(dbPath);
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
