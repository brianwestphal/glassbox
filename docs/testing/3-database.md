# 3. Database

Test coverage for `src/db/connection.ts`, `src/db/queries.ts`, and `src/db/ai-queries.ts` — schema management, CRUD operations, and data integrity.

Database tests should use in-memory PGLite instances (or temp directory instances) initialized with the full schema. Each test suite gets a fresh database to prevent cross-contamination.

## Unit Tests

### Schema and Migrations (`connection.ts`)

- **Fresh initialization** — A new database should have all six tables created: `reviews`, `review_files`, `annotations`, `ai_analyses`, `ai_file_scores`, `user_preferences`.
- **Idempotent re-init** — Calling `initDatabase()` on an already-initialized database should succeed without errors or data loss.
- **Column migrations** — The `addColumnIfMissing` helper should add a column when it doesn't exist and silently skip when it already does.
- **Table structure** — Verify each table has the expected columns, types, and constraints by querying `information_schema`.

### Review Queries (`queries.ts`)

- **`createReview`** — Creates a review with generated ID, repo path, mode, mode_args, HEAD SHA, and `in_progress` status. Verify all fields are persisted and timestamps are set.
- **`getReview`** — Retrieves a review by ID. Verify all fields round-trip correctly, including serialized `mode_args`.
- **`getLatestInProgressReview`** — Returns the most recent `in_progress` review matching the given repo and mode. Returns null when none exists.
- **`getReviewsForRepo`** — Lists all reviews for a repo, ordered by creation time. Verify filtering excludes other repos.
- **`completeReview`** — Sets status to `completed` and records `completed_at`. Verify the review is no longer returned by `getLatestInProgressReview`.
- **`reopenReview`** — Sets status back to `in_progress` and clears `completed_at`.
- **`deleteReview`** — Removes the review and cascades to its files and annotations.

### File Queries (`queries.ts`)

- **`addFilesToReview`** — Bulk inserts files with serialized diff JSON. Verify file count and path uniqueness within a review.
- **`getFilesForReview`** — Returns files with annotation counts. Verify counts are accurate after adding/removing annotations.
- **`getFile`** — Retrieves a single file with its deserialized diff data.
- **`setFileStatus`** — Toggles between `pending` and `reviewed`. Verify the status change persists and `updated_at` is set.
- **`updateReviewDiffs`** — Replaces file diffs with new data. Verify old diffs are replaced and new data is correctly serialized.

### Annotation Queries (`queries.ts`)

- **`createAnnotation`** — Creates an annotation linked to a file, with line number, side, category, and content. Verify all fields persist.
- **`getAnnotation`** — Retrieves a single annotation by ID.
- **`getAnnotationsForFile`** — Returns annotations for a specific file, ordered by line number. Verify ordering.
- **`getAnnotationsForReview`** — Returns all annotations across all files in a review, joined with file paths.
- **`updateAnnotation`** — Updates content and/or category. Verify partial updates (only content, only category, both).
- **`deleteAnnotation`** — Removes an annotation. Verify it no longer appears in listings.
- **`moveAnnotation`** — Changes line number and/or side. Verify the new position is persisted.
- **`markAnnotationStale`** — Sets the stale flag. Verify stale annotations are distinguished in queries.
- **`keepAnnotation`** — Clears the stale flag.
- **`deleteStaleAnnotations`** — Bulk deletes all stale annotations for a review.
- **`keepAllStaleAnnotations`** — Bulk clears stale flags for a review.

### AI Queries (`ai-queries.ts`)

- **`createAnalysis`** — Creates an analysis record with `running` status, linked to a review. Verify type (risk/narrative/guided) is stored.
- **`updateAnalysisProgress`** — Increments progress (completed batches / total batches). Verify intermediate states.
- **`completeAnalysis`** — Sets status to `completed`. Verify the record reflects completion.
- **`failAnalysis`** — Sets status to `failed` with error message. Verify error is persisted.
- **`getLatestAnalysis`** — Returns the most recent analysis of a given type for a review.
- **`saveFileScores`** — Bulk inserts per-file scores with dimension scores (JSON), rationale, and notes. Verify JSON round-trip.
- **`getFileScores`** — Retrieves scores for an analysis, ordered by sort position.
- **`deleteAnalysesForReview`** — Cascades deletion of analyses and their file scores.

### User Preferences (`ai-queries.ts`)

- **`getPreferences`** — Returns the singleton preferences record, or defaults if none exists.
- **`savePreferences`** — Upserts sort mode, risk dimension, and score visibility. Verify partial updates.

## Integration Tests

### Cascade Deletes

- **Review deletion cascades to files** — Deleting a review should also delete all its `review_files` records.
- **Review deletion cascades to annotations** — Deleting a review should delete all annotations on its files.
- **Analysis deletion cascades to scores** — Deleting an analysis should delete all its `ai_file_scores` records.

### Data Integrity

- **Foreign key enforcement** — Attempting to create an annotation referencing a non-existent file should fail.
- **ID uniqueness** — Creating many reviews in rapid succession should produce unique IDs (the `Date.now() + random` scheme).
- **Concurrent writes** — Multiple annotation creates on the same file should not conflict or lose data.

### Query Correctness

- **Annotation counts in file listing** — After creating annotations across multiple files, verify `getFilesForReview` returns accurate per-file counts.
- **Stale counts in file listing** — After marking some annotations stale, verify stale counts are tracked separately from active counts.
- **Review filtering by repo** — Reviews from different repos should not leak into each other's listings.
- **Review filtering by mode** — `getLatestInProgressReview` should match on both repo and mode.

## Edge Cases

- **Empty review** — A review with no files. Verify file and annotation queries return empty arrays, not errors.
- **Annotation on line 0** — If a line number of 0 is possible (e.g., file-level annotation), verify it is handled.
- **Very long annotation content** — Content exceeding typical sizes (10KB+). Verify it stores and retrieves without truncation.
- **Special characters in content** — Annotations with quotes, backslashes, null characters, unicode, and HTML. Verify round-trip integrity.
- **Null mode_args** — Reviews with no mode arguments (e.g., `uncommitted` mode). Verify null/empty handling in serialization.
