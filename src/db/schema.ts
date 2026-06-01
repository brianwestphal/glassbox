/**
 * Database schema SQL constants.
 *
 * Single source of truth for table definitions. Used by the production
 * connection module and by test helpers that create in-memory databases.
 */

/** Core tables: reviews, review_files, annotations. */
export const SCHEMA_CORE_SQL = `
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
`;

/** AI tables: analyses, file scores, user preferences. */
export const SCHEMA_AI_SQL = `
  CREATE TABLE IF NOT EXISTS ai_analyses (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    analysis_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    progress_completed INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
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
    show_risk_scores BOOLEAN NOT NULL DEFAULT FALSE,
    ignore_whitespace BOOLEAN NOT NULL DEFAULT FALSE,
    svg_view_mode TEXT NOT NULL DEFAULT 'code',
    last_image_mode TEXT NOT NULL DEFAULT 'metadata',
    scope_filter TEXT NOT NULL DEFAULT 'all'
  );
`;
