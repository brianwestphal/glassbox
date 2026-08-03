# 9. Data Storage

Requirements for data persistence, database schema, and data management.

## Functional Requirements

### 9.1 Database

- The system shall use PGLite (embedded PostgreSQL compiled to WASM) as the database engine.
- Database files shall be stored locally and **project-local**, under the review's data directory at `<repo>/.glassbox/data/reviews` (the data directory defaults to `<cwd>/.glassbox` and is overridable with `--data-dir`; see `src/cli.ts` → `setDataDir` in `src/db/connection.ts`). This is distinct from the **global config** directory `~/.glassbox` (§9.3), which holds only machine-wide AI configuration and custom themes — the review database itself never lives under `~/.glassbox`.
- The database schema shall be initialized automatically on first use.
- Schema migrations shall be applied safely on startup without data loss.
- The application tables shall live in the `template1` database. PGLite ≤0.3.x used `template1` as its default working database; PGLite 0.4.0 changed the default to `postgres`. To keep existing on-disk data dirs readable across that upgrade, the connection explicitly pins `database: 'template1'` (see `src/db/connection.ts`) so the storage location is identical for both pre-0.4 and freshly created databases. A future PGLite upgrade must preserve this option (or perform a one-time `template1` → `postgres` data migration) or existing users' reviews will appear to vanish.

### 9.1a PostgreSQL Major-Version Upgrades

PGLite embeds a fixed PostgreSQL major and ships no `pg_upgrade`, so a data directory written by an older engine cannot be opened at all — the failure is total, and PGLite reports it as a bare `PGlite failed to initialize properly`, indistinguishable by message from real corruption. PGLite 0.5.0 moved the embedded engine from PostgreSQL 17 to 18, which every existing user's data directory predates.

- On an open failure, the system shall attempt a one-time major-version migration **before** the corruption-recovery path in §9.5, and shall skip it when the directory's major already matches the running engine.
- The migration shall read the on-disk major from `PG_VERSION` **without booting the cluster**, so the check costs nothing for directories that do not need it.
- The old engine shall be **downloaded on demand** (pinned version, verified against a `sha512` integrity hash) rather than shipped, and removed once the migration completes — shipping a second ~25 MB engine permanently would burden every user for a one-time, once-per-user operation.
- The migration shall write to a **staged sibling** directory and shall move it into the canonical location only after post-migration validation passes; the original directory shall never be modified in place.
- A copy of the original shall be retained alongside the upgraded database, taken **before** the old engine opens the directory (starting a cluster can write to it during recovery, so a later copy would not reflect what the user had). Exactly one copy shall be kept — the swap's own displaced copy is discarded so an upgrade does not double the on-disk cost.
- When the migration cannot complete (most often no network connection), the system shall **fail to start with an actionable message** naming the source major and the blocking reason, and shall **not** fall through to the quarantine path in §9.5. Quarantining would leave an empty cluster at the canonical path and strand the user's history permanently, since no later launch would retry; failing loudly keeps the data in place and self-heals once the user is online.

- The retained copy shall be **surfaced to the user, not silently deleted**. Settings → General shall show a **Database backups** section listing each retained backup with its size on disk, when it was taken, and its absolute path, with a **Delete** action behind a confirmation. The section shall render only when a backup exists, so the overwhelming majority of users — who never upgrade across a Postgres major — never see it. This follows the same stance as §9.5: the app preserves the user's data and lets *them* decide when it is no longer needed.
- The delete action shall be scoped to backups. Only a `reviews.bak-<timestamp>` sibling may be removed; the live cluster, a staged `reviews.migrating-<timestamp>` directory, and the quarantined `reviews.unreadable-<timestamp>` directories from §9.5 shall all be refused.
- The quarantined directories from §9.5 shall be listed in their **own** section — "Preserved unreadable data" — with a **Reveal** action that opens the OS file manager and **no delete**. Keeping them separate is the requirement, not an implementation detail: a backup is redundant by construction (the migration validated every row reached the live cluster), whereas a quarantined directory is data Glassbox *failed* to read and may be the user's only copy. Presenting both with the same affordance would flatten a distinction the user needs in order to decide safely, so Glassbox points at the unreadable data and leaves removing it to them.

Implemented by `src/db/migrate-major.ts` (`migrateMajorIfNeeded`) over the `pglite-migrate` library, called from `getDb()`; the listing, deletion, and reveal by `src/db/backups.ts` behind `GET /api/db-backups`, `DELETE /api/db-backups/:name`, and `POST /api/db-backups/:name/reveal`, rendered by `src/client/settings/generalTab.tsx`. Covered by mocked unit tests plus a live PG17→PG18 round-trip (`npm run test:live`) and an e2e over the settings section.

### 9.2 Data Model

The system shall persist the following seven entities:

- **reviews** — Review sessions with repository path, name, mode, mode arguments, HEAD commit, status (in_progress/completed), and timestamps.
- **review_files** — Files within each review with file path, review status (pending/reviewed), and serialized diff data.
- **annotations** — Line-level annotations with file reference, line number, side, category, content, stale flag, and timestamps.
- **ai_analyses** — AI analysis run records with review reference, analysis type, status, progress, and error tracking.
- **ai_file_scores** — Per-file AI scores with analysis reference, sort order, aggregate score, dimension scores, rationale, and notes.
- **user_preferences** — Singleton record for UI preferences (sort mode, risk dimension, score visibility).
- **attachments** — Reviewer file attachments on an annotation (doc 25), referencing the owning annotation, with original filename, on-disk stored path, MIME type, size, and optional sha256. Bytes live on disk under `<dataDir>/attachments/`; this table holds the metadata.

### 9.3 Configuration Files

- Global AI configuration shall be stored in `~/.glassbox/config.json` with `0600` file permissions.
- The global config directory shall default to `~/.glassbox` but be overridable via the `GLASSBOX_CONFIG_DIR` environment variable, so automated runs (notably the e2e suite) can redirect global state — AI platform/keys, custom themes — to a disposable directory instead of mutating the developer's real config (GB-923).
- Project-specific settings shall be stored in `<repo>/.glassbox/settings.json`.
- Project-specific settings shall also be accessible via `GET /api/project-settings` and `PATCH /api/project-settings` API endpoints.
- API keys in the config file shall be stored with base64 encoding.

## Non-Functional Requirements

### 9.4 Data Locality

- All user data shall remain on the local machine. No data shall be transmitted to external services except AI API calls when explicitly opted in.
- No accounts, telemetry, or usage tracking shall be implemented.

### 9.5 Data Integrity

- Database operations shall use raw SQL queries (no ORM).
- Entity IDs shall be generated using `Date.now().toString(36) + Math.random().toString(36).slice(2, 10)`.
- The system shall not corrupt data on unexpected shutdown (PGLite handles WASM-level crash recovery).
- A data directory that cannot be opened shall never be deleted. "The engine could not open it" is not the same as "the bytes are worthless" — the same failure is produced by a half-written WAL, a file locked by another process, or a directory written by a different PostgreSQL major (§9.1a). The system shall move it aside to `reviews.unreadable-<timestamp>`, print that path, and start fresh; if it cannot be moved, the system shall rethrow rather than fall back to deleting.

### 9.6 Data Isolation

- Reviews from different repositories shall be isolated by `repo_path`.
- The instance lock file (`glassbox.lock`) shall prevent concurrent database access from multiple processes.
