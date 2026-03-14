# 2. CLI and Server

Requirements for the command-line interface, HTTP server, API surface, and browser launch behavior.

## Functional Requirements

### 2.1 CLI Entry Point

- **Invocation** — The application shall be invoked as `glassbox [options]` from a terminal.
- **Default mode** — Running with no arguments shall default to `--uncommitted` mode.
- **Help flag** — `--help` / `-h` shall print usage information and exit.
- **Unknown options** — Unknown options shall produce an error, print usage, and exit with a non-zero code.

### 2.2 CLI Options

The CLI shall accept the following options:

| Option | Description |
|--------|-------------|
| `--uncommitted` | Review all uncommitted changes (staged + unstaged + untracked) |
| `--staged` | Review only staged changes |
| `--unstaged` | Review only unstaged changes |
| `--commit <sha>` | Review changes from a specific commit |
| `--range <from>..<to>` | Review changes between two refs |
| `--branch <name>` | Review changes on current branch vs the named branch |
| `--files <patterns>` | Review specific files (comma-separated glob patterns) |
| `--all` | Review entire codebase |
| `--port <number>` | Port to run on (default: 4183) |
| `--resume` | Resume the latest in-progress review for this mode |
| `--no-open` | Don't open browser automatically |
| `--strict-port` | Fail if the requested port is in use |
| `--project-dir <dir>` | Run as if invoked from `<dir>` (used by Tauri desktop app) |
| `--check-for-updates` | Check for a newer version on npm |
| `--debug` | Show build timestamp and debug info |
| `--ai-service-test` | Use mock AI responses (no API calls) |
| `--demo:N` | Launch pre-configured demo scenario N |

### 2.3 Startup Sequence

- **Arg parsing first** — The CLI shall parse arguments and determine the review mode before any git or database operations.
- **Project dir override** — `--project-dir` shall change the working directory before any git operations (used by Tauri sidecar).
- **Instance locking** — Instance locking shall be acquired after argument parsing but before database access (see doc 1, section 1.5).
- **Git repo check** — The CLI shall verify it is running inside a git repository before proceeding (unless in demo mode).
- **Update check** — An npm update check shall run once per day (or immediately with `--check-for-updates`) before starting the server.

### 2.4 HTTP Server

- **Framework** — The server shall be a Hono HTTP application running on `@hono/node-server`.
- **Default port** — The default port shall be 4183.
- **Port fallback** — If the default port is in use, the server shall try up to 20 successive ports automatically.
- **Strict port mode** — With `--strict-port`, the server shall fail if the requested port is in use rather than trying alternatives.
- **Ready message** — On successful startup, the server shall print `Glassbox running at http://localhost:{port}` to stdout (this message is also parsed by the Tauri sidecar to detect readiness).

### 2.5 Context Middleware

- **Injected variables** — The server shall inject three context variables into every request via middleware:
  - `reviewId` — the current review session ID
  - `currentReviewId` — same as `reviewId` (used for distinguishing when viewing past reviews)
  - `repoRoot` — the repository root path
- **Type safety** — These variables shall be typed via the `AppEnv` interface and accessible in all route handlers.

### 2.6 Static Asset Serving

- **CSS route** — The server shall serve client CSS at `GET /static/styles.css`.
- **JS route** — The server shall serve client JavaScript at `GET /static/app.js`.
- **Cache control** — Static assets shall be served with `Cache-Control: no-cache` to ensure fresh content during development.
- **Asset resolution** — Asset resolution shall check both the co-located `client/` directory (production) and the `../dist/client/` directory (development).

### 2.7 API Routes

The server shall expose three route groups:

- **Review and file APIs** — `/api/*` — Review management, file operations, annotation CRUD, project settings, gitignore handling, and context expansion.
- **AI APIs** — `/api/ai/*` — AI configuration, analysis triggering, model listing, API key management, and user preferences.
- **Pages** — `/*` — Server-rendered HTML pages (main review, file view, past review view, review history).

### 2.8 API Endpoints — Review Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reviews` | List all reviews for the current repository |
| GET | `/api/review` | Get the current review's details |
| POST | `/api/review/complete` | Mark review as completed, generate export |
| POST | `/api/review/reopen` | Reopen a completed review |
| DELETE | `/api/review/:id` | Delete a past review (not the current one) |
| POST | `/api/reviews/delete-completed` | Bulk delete all completed reviews |
| POST | `/api/reviews/delete-all` | Bulk delete all reviews except the current one |

### 2.9 API Endpoints — Files and Annotations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files` | List files with annotation and stale counts |
| GET | `/api/files/:fileId` | Get file details and its annotations |
| PATCH | `/api/files/:fileId/status` | Mark file as reviewed or pending |
| POST | `/api/annotations` | Create an annotation |
| PATCH | `/api/annotations/:id` | Update annotation content or category |
| DELETE | `/api/annotations/:id` | Delete an annotation |
| PATCH | `/api/annotations/:id/move` | Move annotation to a different line/side |
| POST | `/api/annotations/:id/keep` | Mark a stale annotation as current |
| POST | `/api/annotations/stale/delete-all` | Batch delete all stale annotations |
| POST | `/api/annotations/stale/keep-all` | Batch keep all stale annotations |
| GET | `/api/annotations/all` | Get all annotations for a review |

### 2.10 API Endpoints — Context, Outline, and Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/context/:fileId` | Fetch lines from the working directory file |
| GET | `/api/outline/:fileId` | Parse and return code symbols/functions |
| GET | `/api/project-settings` | Read project-specific settings |
| PATCH | `/api/project-settings` | Save project-specific settings |
| POST | `/api/gitignore/add` | Add `.glassbox/` to `.gitignore` |
| POST | `/api/gitignore/dismiss` | Dismiss gitignore prompt (30-day cooldown) |

### 2.11 API Endpoints — AI

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ai/config` | Get current AI platform, model, and key status |
| POST | `/api/ai/config` | Save platform, model, and guided review settings |
| GET | `/api/ai/models` | List available platforms and models |
| GET | `/api/ai/key-status` | Check which platforms have keys configured |
| POST | `/api/ai/key` | Save an API key |
| DELETE | `/api/ai/key` | Delete an API key |
| POST | `/api/ai/analyze` | Trigger risk, narrative, or guided analysis |
| GET | `/api/ai/preferences` | Get user sort/display preferences |
| POST | `/api/ai/preferences` | Save user sort/display preferences |

### 2.12 Server-Rendered Pages

| Path | Description |
|------|-------------|
| `/` | Main review page (sidebar + diff viewer) |
| `/file/:fileId` | File diff fragment (loaded into main content area) |
| `/review/:reviewId` | View a past review (read-only or reopenable) |
| `/history` | Review history listing |

### 2.13 Browser Launch

- **Auto-open** — On startup, the server shall automatically open the review URL in the user's default browser.
- **Suppress flag** — `--no-open` shall suppress automatic browser opening (used by the Tauri sidecar, which navigates its own webview instead).
- **Platform commands** — Browser launch shall use platform-appropriate commands: `open` (macOS), `start` (Windows), `xdg-open` (Linux).

## Non-Functional Requirements

### 2.14 Response Format

- **API format** — API routes shall return JSON responses.
- **Page format** — Page routes shall return server-rendered HTML using the custom JSX runtime.

### 2.15 Error Handling

- **HTTP status codes** — API routes shall return appropriate HTTP status codes (404 for not found, 400 for bad input).
- **CLI error handling** — Unhandled errors in the CLI `main()` function shall be caught, logged to stderr, and cause a non-zero exit.

### 2.16 Startup Output

- **Stdout readiness** — The `Glassbox running at http://localhost:{port}` message shall be printed to stdout (not stderr), as it is parsed by the Tauri sidecar to detect when the server is ready.
- **Port conflict logging** — If the port was changed due to a conflict, the server shall log a message indicating the original and actual ports.
