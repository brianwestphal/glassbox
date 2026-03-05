import { PGlite } from '@electric-sql/pglite';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const dataDir = join(homedir(), '.glassbox', 'data');
mkdirSync(dataDir, { recursive: true });

let db: PGlite | null = null;

export async function getDb(): Promise<PGlite> {
  if (db) return db;
  db = new PGlite(join(dataDir, 'reviews'));
  await db.waitReady;
  await initSchema(db);
  return db;
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

  // Migrations for existing databases
  try { await db.exec('ALTER TABLE reviews ADD COLUMN head_commit TEXT'); } catch {}
  try { await db.exec('ALTER TABLE annotations ADD COLUMN is_stale BOOLEAN NOT NULL DEFAULT FALSE'); } catch {}
  try { await db.exec('ALTER TABLE annotations ADD COLUMN original_content TEXT'); } catch {}
}
