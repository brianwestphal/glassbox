import { PGlite } from '@electric-sql/pglite';
import { mkdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

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
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      repo_path TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      mode TEXT NOT NULL,
      mode_args TEXT,
      head_commit TEXT,
      status TEXT NOT NULL DEFAULT 'in_progress',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS review_files (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      diff_data TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_review_files_review ON review_files(review_id);

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      review_file_id TEXT NOT NULL REFERENCES review_files(id) ON DELETE CASCADE,
      line_number INTEGER NOT NULL,
      side TEXT NOT NULL DEFAULT 'new',
      category TEXT NOT NULL DEFAULT 'note',
      content TEXT NOT NULL,
      is_stale BOOLEAN NOT NULL DEFAULT FALSE,
      original_content TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_annotations_file ON annotations(review_file_id);
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_analyses (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      analysis_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ai_analyses_review ON ai_analyses(review_id);

    CREATE TABLE IF NOT EXISTS ai_file_scores (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL REFERENCES ai_analyses(id) ON DELETE CASCADE,
      review_file_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      aggregate_score REAL,
      rationale TEXT,
      dimension_scores TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ai_file_scores_analysis ON ai_file_scores(analysis_id);

    CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY DEFAULT 'singleton',
      sort_mode TEXT NOT NULL DEFAULT 'folder',
      risk_sort_dimension TEXT NOT NULL DEFAULT 'aggregate',
      show_risk_scores BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);

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
