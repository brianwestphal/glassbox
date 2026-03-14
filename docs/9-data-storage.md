# 9. Data Storage

Requirements for data persistence, database schema, and data management.

## Functional Requirements

### 9.1 Database

- The system shall use PGLite (embedded PostgreSQL compiled to WASM) as the database engine.
- Database files shall be stored locally in `~/.glassbox/data/reviews`.
- The database schema shall be initialized automatically on first use.
- Schema migrations shall be applied safely on startup without data loss.

### 9.2 Data Model

The system shall persist the following entities:

- **reviews** — Review sessions with repository path, name, mode, mode arguments, HEAD commit, status (in_progress/completed), and timestamps.
- **review_files** — Files within each review with file path, review status (pending/reviewed), and serialized diff data.
- **annotations** — Line-level annotations with file reference, line number, side, category, content, stale flag, and timestamps.
- **ai_analyses** — AI analysis run records with review reference, analysis type, status, progress, and error tracking.
- **ai_file_scores** — Per-file AI scores with analysis reference, sort order, aggregate score, dimension scores, rationale, and notes.
- **user_preferences** — Singleton record for UI preferences (sort mode, risk dimension, score visibility).

### 9.3 Configuration Files

- Global AI configuration shall be stored in `~/.glassbox/config.json` with `0600` file permissions.
- Project-specific settings shall be stored in `<repo>/.glassbox/settings.json`.
- API keys in the config file shall be stored with base64 encoding.

## Non-Functional Requirements

### 9.4 Data Locality

- All user data shall remain on the local machine. No data shall be transmitted to external services except AI API calls when explicitly opted in.
- No accounts, telemetry, or usage tracking shall be implemented.

### 9.5 Data Integrity

- Database operations shall use raw SQL queries (no ORM).
- Entity IDs shall be generated using `Date.now().toString(36) + Math.random().toString(36).slice(2, 10)`.
- The system shall not corrupt data on unexpected shutdown (PGLite handles WASM-level crash recovery).

### 9.6 Data Isolation

- Reviews from different repositories shall be isolated by `repo_path`.
- The instance lock file (`glassbox.lock`) shall prevent concurrent database access from multiple processes.
