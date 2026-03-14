# 8. Infrastructure

Test coverage for CLI argument parsing, server startup, instance locking, port management, update checking, and Tauri desktop integration.

## Unit Tests

### CLI Argument Parsing (`src/cli.ts`)

- **Default mode** — No arguments defaults to `uncommitted` mode.
- **Explicit modes** — Each mode flag (`--staged`, `--unstaged`, `--commit`, `--range`, `--branch`, `--files`, `--all`) is parsed correctly.
- **Mode with argument** — `--commit abc123`, `--range main..feature`, `--branch main`, `--files "*.ts,*.tsx"` capture their arguments.
- **Port option** — `--port 5000` sets the port to 5000.
- **Boolean flags** — `--no-open`, `--strict-port`, `--debug`, `--resume` are parsed as true when present.
- **Help flag** — `--help` or `-h` triggers usage output.
- **Unknown option** — `--banana` produces an error and non-zero exit.
- **Missing argument** — `--commit` without a SHA produces an error.
- **Demo mode** — `--demo:3` parses the scenario ID correctly.
- **Project dir** — `--project-dir /tmp/foo` sets the working directory.
- **Combined options** — `--staged --port 5000 --no-open` all parsed together.

### Instance Locking (`src/lock.ts`)

- **Acquire lock** — Creates a lock file in `~/.glassbox/` containing the current PID.
- **Detect active lock** — When another process holds the lock (PID is alive), acquisition fails with a clear message.
- **Stale lock cleanup** — When the lock file exists but the PID is dead, the lock is removed and re-acquired.
- **Release lock** — On exit, the lock file is removed.
- **Demo mode bypass** — In demo mode, locking is skipped entirely.

### Update Checking (`src/update-check.ts`)

- **Newer version available** — Mock npm registry response with a higher version. Verify the banner message is generated with the correct upgrade command.
- **Already up to date** — Registry returns the same version. Verify no banner.
- **Network error** — Registry is unreachable. Verify graceful failure (no crash, no banner).
- **Timeout** — Registry doesn't respond within 5 seconds. Verify the check is abandoned without blocking.
- **Package manager detection** — Verify the upgrade command uses the correct package manager (npm, yarn, pnpm, bun) based on the install path.
- **Daily throttle** — Verify the check only runs once per day (timestamp-based gate).

## Integration Tests

### Server Startup (`src/server.ts`)

- **Successful start** — Start the server on a free port. Verify the "Glassbox running at" message is printed to stdout.
- **Port fallback** — Occupy the default port, then start the server. Verify it falls back to the next available port.
- **Strict port failure** — Occupy the requested port and start with `--strict-port`. Verify the server fails with an error.
- **Context middleware** — Make a request after startup. Verify `reviewId`, `currentReviewId`, and `repoRoot` are available in the handler context.
- **Static asset serving** — Request `/static/styles.css` and `/static/app.js`. Verify 200 responses with correct content types and `Cache-Control: no-cache`.
- **Asset fallback paths** — Verify the server checks both `client/` (production) and `../dist/client/` (development) for assets.

### Server-Rendered Pages (`src/routes/pages.tsx`)

- **Main page** — `GET /` returns HTML with the sidebar and diff viewer structure.
- **File page** — `GET /file/:fileId` returns the diff fragment for a specific file.
- **Past review** — `GET /review/:reviewId` returns the review view for a completed review.
- **History page** — `GET /history` returns the review history listing.
- **404 handling** — Requesting a non-existent route or file ID returns appropriate error.

### Full CLI Startup

These are slower tests that exercise the full startup path.

- **Happy path** — Run the CLI in a temp git repo with uncommitted changes. Verify: git repo detected, database initialized, review created, server started, ready message printed.
- **Not a git repo** — Run the CLI outside a git repo. Verify an error is printed and the process exits.
- **Empty diff** — Run in a repo with no changes in the selected mode. Verify the "no changes found" message.
- **Resume flag** — Run with `--resume` when an in-progress review exists. Verify the review is reused.
- **Resume fallback** — Run with `--resume` when no in-progress review exists. Verify a new review is created.

## Desktop App Testing (`src-tauri/`)

Tauri integration testing is limited because it requires the Tauri runtime. Focus on testing the Node.js side of the integration points.

### IPC Commands (behavior verified via the Node.js API)

- **Project settings round-trip** — Write `appName` via `PATCH /api/project-settings`, read it back via `GET /api/project-settings`. This is the data the Tauri Rust code reads for window titles.
- **Update banner** — When the Tauri-specific update banner HTML is present in the page, verify it renders with the correct version and install/dismiss buttons.

### Sidecar Communication

- **Ready message parsing** — The Tauri app watches stdout for `Glassbox running at http://localhost:{port}`. Verify this message is printed in the exact expected format.
- **Port in message** — When the port changes due to fallback, verify the message reflects the actual port.

## Edge Cases

- **Rapid restarts** — Start and stop the server rapidly. Verify lock files are cleaned up and no zombie processes remain.
- **Corrupted lock file** — A lock file with invalid content (not a PID). Verify it is treated as stale and replaced.
- **Very high port numbers** — `--port 65535` should work. `--port 70000` should fail gracefully.
- **Invalid port** — `--port abc` should produce a clear error.
- **Missing data directory** — `~/.glassbox/` doesn't exist on first run. Verify it is created automatically.
- **Read-only data directory** — `~/.glassbox/` exists but is read-only. Verify a clear error message.
- **Multiple mode flags** — `--staged --unstaged` (conflicting modes). Verify one takes precedence or an error is shown.
- **Signal handling** — Send SIGINT during startup. Verify cleanup runs (lock file removed, database connection closed).
