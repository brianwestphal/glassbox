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
| `--diff <pathA> <pathB>` | Compare two arbitrary files or folders by path (no git repo required — see doc 18) |
| `glassbox-difftool <a> <b>` *(separate bin)* | git-difftool bridge — dereferences symlinks in the two `--dir-diff` snapshot dirs, then exec's `glassbox --diff`. See README "Use as `git difftool`" for the config snippet. |
| `--register-difftool` | Register Glassbox as the current `git difftool` (writes `diff.tool`, `difftool.glassbox.cmd`, `difftool.prompt` at `--global` scope by default). Refuses to overwrite a non-Glassbox tool unless `--force` is also passed. Combine with `--local` to apply only inside the current repo. |
| `--unregister-difftool` | Remove the Glassbox `git difftool` entries (only touches the keys we set; leaves third-party tools alone). |
| `--local` | Used with `--register-difftool` / `--unregister-difftool`: scope the change to the current repository (`git config --local`) instead of `--global`. |
| `--force` | Used with `--register-difftool`: overwrite an existing non-Glassbox `diff.tool` setting. |
| `--port <number>` | Port to run on (default: 4183) |
| `--resume` | Resume the latest in-progress review for this mode |
| `--no-open` | Don't open browser automatically |
| `--strict-port` | Fail if the requested port is in use |
| `--project-dir <dir>` | Run as if invoked from `<dir>` (used by Tauri desktop app) |
| `--data-dir <dir>` | Override the per-project data directory (default `<repo>/.glassbox` — doc 9) |
| `--ground-truth <manifest>` | Ground-truth image comparison mode (no git repo required — see doc 26) |
| `--on-complete <cmd>` | Run `<cmd>` when a review is **explicitly completed** (doc [6](6-export.md), GB-974) |
| `--check-for-updates` | Check for a newer version on npm |
| `--debug` | Show build timestamp and debug info |
| `--ai-service-test` | Use mock AI responses (no API calls) |
| `--demo:N` | Launch pre-configured demo scenario N |

### 2.3 Startup Sequence

- **Arg parsing first** — The CLI shall parse arguments and determine the review mode before any git or database operations.
- **Project dir override** — `--project-dir` shall change the working directory before any git operations (used by Tauri sidecar).
- **Instance locking** — Instance locking shall be acquired after argument parsing but before database access (see doc 1, section 1.5).
- **Git repo check** — The CLI shall verify it is running inside a git repository before proceeding (unless in demo mode, or in `--diff` mode per doc 18).
- **Update check** — An npm update check shall run once per day (or immediately with `--check-for-updates`) before starting the server.

### 2.3a Completion hook (`--on-complete`)

- **FR-2.3a — Completion hook.** When `--on-complete <command>` is given, the
  server shall run `<command>` (via the shell) when a review is **explicitly
  completed** (the Complete Review button / `POST /api/review/complete`) — never
  on the debounced per-annotation auto-export (doc [6](6-export.md)). It is the
  generic, AI-free generalization of the channel's "Send to Claude" button
  (doc [17](17-claude-channel.md)): a project wires it to act on the structured
  JSON export (e.g. file tickets). Implemented in `src/export/on-complete-hook.ts`.
- **Environment** — the command receives the export locations via
  `GLASSBOX_REVIEW_JSON` (the structured JSON, doc 6 §6.2a), `GLASSBOX_REVIEW_MD`,
  `GLASSBOX_REVIEW_ID`, and `GLASSBOX_REPO_ROOT`; its cwd is the repo root. Output
  is captured to `<repo>/.glassbox/on-complete.log`.
- **Robustness** — the review is marked completed and exported **before** the
  hook runs, so an absent, failing, or unspawnable hook never affects the review
  state; the hook outcome (`{ ran, ok, exitCode, error? }`) is reported back on
  the completion response but is advisory.
- **Security (doc [14](14-security.md))** — the command is supplied by the user
  on their **own** CLI invocation and runs on a localhost-only server. There is
  no API to set it, so it is **never** taken from network input and introduces no
  remote-execution surface beyond what the user already controls locally.

### 2.4 HTTP Server

- **Framework** — The server shall be a Hono HTTP application running on `@hono/node-server`.
- **Localhost binding** — The server shall bind to `127.0.0.1` only (see doc 14, section 14.1).
- **Default port** — The default port shall be 4183.
- **Port fallback** — If the default port is in use, the server shall try up to 20 successive ports automatically.
- **Strict port mode** — With `--strict-port`, the server shall fail if the requested port is in use rather than trying alternatives.
- **Ready message** — On successful startup, the server shall print `Glassbox running at http://localhost:{port}` to stdout (this message is also parsed by the Tauri sidecar to detect readiness).

### 2.5 Context Middleware

- **Injected variables** — The server shall inject four context variables into every request via middleware:
  - `reviewId` — the current review session ID
  - `currentReviewId` — same as `reviewId` (used for distinguishing when viewing past reviews)
  - `repoRoot` — the repository root path
  - `onCompleteCommand` — the `--on-complete` command to run at explicit completion (empty when unset; doc 6)
- **Type safety** — These variables shall be typed via the `AppEnv` interface and accessible in all route handlers.

### 2.6 Static Asset Serving

- **CSS route** — The server shall serve client CSS at `GET /static/styles.css`.
- **JS routes** — The server shall serve client JavaScript at `GET /static/app.js` and the history page's bundle at `GET /static/history.js`.
- **Favicon** — The server shall serve `GET /favicon.svg` and answer `GET /favicon.ico` with a 204 (no icon churn in logs).
- **Cache control** — Static assets shall be served with `Cache-Control: no-cache` to ensure fresh content during development.
- **Asset resolution** — Asset resolution shall check both the co-located `client/` directory (production) and the `../dist/client/` directory (development).

### 2.7 API Routes

The server shall expose these route groups:

- **Review and file APIs** — `/api/*` — Review management, file operations, annotation CRUD, project settings, plugins, attachments, review notes, and context expansion.
- **AI APIs** — `/api/ai/*` — AI configuration, analysis triggering, model listing, API key management, and user preferences.
- **Theme APIs** — `/api/themes/*` — see doc [15](15-themes.md).
- **Channel APIs** — `/api/channel/*` — see doc [17](17-claude-channel.md).
- **Difftool APIs** — `/api/difftool/*` — see doc [19](19-difftool-integration.md).
- **Pages** — `/*` — Server-rendered HTML pages (main review, file view, past review view, review history).

**FR-2.7a Typed API layer.** Every endpoint shall be backed by a typed module under `src/api/<resource>.ts` that defines the request and response shapes (`XReq` / `XResp` interfaces) **and** the client-side caller function that wraps the underlying HTTP call (e.g. `createAnnotation({...})`, `getContextLines({...})`). The same module's types shall be imported by the corresponding server route handler via `import type { XReq, XResp }` and used to constrain `c.req.json<XReq>()` and `c.json<XResp>(...)`. The intent is that adding or changing an endpoint requires editing one resource module and one route handler — drift between the two then fails to compile.

- Client code shall not call the raw `api<T>()` helper from `src/client/api.ts` directly. Every call site shall use a typed caller imported from `src/api/<resource>.ts` (or, equivalently, `apis.<name>(...)` from `src/api/index.ts`).
- The flat namespace `apis` aggregates every per-resource caller; caller names shall therefore be globally unique across modules (`createAnnotation`, `getCurrentReview`, `getAIConfig`, `getOutline`, etc.).
- Binary endpoints that the browser fetches via `<img src>` (e.g. `/api/image/:fileId/:side`) expose a URL builder (`imageUrl({ fileId, side })`) rather than a fetch caller.

### 2.8 API Endpoints — Review Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reviews` | List all reviews for the current repository |
| GET | `/api/review` | Get the current review's details |
| POST | `/api/review/complete` | Mark review as completed, generate export |
| POST | `/api/review/reopen` | Reopen a completed review |
| POST | `/api/review/refresh` | Re-scan the working tree and update the current review's files/diffs |
| DELETE | `/api/review/:id` | Delete a past review (not the current one) |
| POST | `/api/reviews/delete-completed` | Bulk delete all completed reviews |
| POST | `/api/reviews/delete-all` | Bulk delete all reviews except the current one |

### 2.9 API Endpoints — Files and Annotations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files` | List files with annotation and stale counts |
| GET | `/api/files/:fileId` | Get file details and its annotations |
| PATCH | `/api/files/:fileId/status` | Mark file as reviewed or pending |
| GET | `/api/files/:fileId/path` | Get the file's absolute on-disk path |
| POST | `/api/files/:fileId/reveal` | Reveal the file in the OS file manager |
| POST | `/api/files/:fileId/open` | Open the file with the OS default application |
| POST | `/api/annotations` | Create an annotation |
| PATCH | `/api/annotations/:id` | Update annotation content or category |
| DELETE | `/api/annotations/:id` | Delete an annotation |
| PATCH | `/api/annotations/:id/move` | Move annotation to a different line/side |
| PATCH | `/api/annotations/:id/region` | Update an image-region annotation's `{x,y,w,h}` region |
| POST | `/api/annotations/:id/keep` | Mark a stale annotation as current |
| POST | `/api/annotations/stale/delete-all` | Batch delete all stale annotations |
| POST | `/api/annotations/stale/keep-all` | Batch keep all stale annotations |
| GET | `/api/annotations/all` | Get all annotations for a review |

### 2.10 API Endpoints — Context, Outline, and Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/context/:fileId` | Fetch lines from the working directory file |
| GET | `/api/outline/:fileId` | Parse and return code symbols/functions |
| GET | `/api/symbol-definition` | Resolve a symbol to its definition location (go-to-definition, doc 13) |
| GET | `/api/project-settings` | Read project-specific settings |
| PATCH | `/api/project-settings` | Save project-specific settings |
| POST | `/api/open-external` | Open an http(s) URL in the OS default browser (used by external links in the desktop app) |

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
| GET | `/api/ai/analysis/:type` | Fetch a completed analysis result (risk / narrative / guided) |
| GET | `/api/ai/analysis/:type/status` | Poll an in-flight analysis's progress (drives the §7.5 progress display) |
| GET | `/api/ai/debug-status` | AI debug-logging status (diagnostics) |
| POST | `/api/ai/debug-log` | Append a client-side AI debug log entry (diagnostics) |
| GET | `/api/ai/preferences` | Get user sort/display preferences |
| POST | `/api/ai/preferences` | Save user sort/display preferences |

### 2.12 API Endpoints — Attachments and Review Notes

Reviewer file attachments on annotations (doc 25) and AI-authored review notes (doc 20).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/attachments/all` | List all attachments for the current review |
| GET | `/api/annotations/:id/attachments` | List attachments on an annotation |
| POST | `/api/annotations/:id/attachments` | Upload an attachment onto an annotation |
| GET | `/api/attachments/:id/raw` | Fetch an attachment's bytes (used for image thumbnails/lightbox) |
| POST | `/api/attachments/:id/quicklook` | Open an attachment via OS Quick Look / default opener |
| DELETE | `/api/attachments/:id` | Delete an attachment |
| GET | `/api/review-notes/artifact` | Serve a path-contained `.pr-notes/` note artifact (text/image) |
| DELETE | `/api/review-notes/:guid` | Discard a stale AI review note from `.pr-notes/` |

### 2.13 Server-Rendered Pages

| Path | Description |
|------|-------------|
| `/` | Main review page (sidebar + diff viewer) |
| `/file/:fileId` | File diff fragment (loaded into main content area) |
| `/file-raw` | Read-only view of a repo file not in the diff (go-to-definition target, doc 13). Path-contained to the repo root — a traversal/absolute path returns 403 |
| `/review/:reviewId` | View a past review (read-only or reopenable) |
| `/history` | Review history listing |

### 2.14 Browser Launch

- **Auto-open** — On startup, the server shall automatically open the review URL in the user's default browser.
- **Suppress flag** — `--no-open` shall suppress automatic browser opening (used by the Tauri sidecar, which navigates its own webview instead).
- **Platform commands** — Browser launch shall use platform-appropriate commands: `open` (macOS), `start` (Windows), `xdg-open` (Linux).

## Non-Functional Requirements

### 2.15 Response Format

- **API format** — API routes shall return JSON responses.
- **Page format** — Page routes shall return server-rendered HTML using the kerfjs JSX runtime.

### 2.16 Error Handling

- **HTTP status codes** — API routes shall return appropriate HTTP status codes (404 for not found, 400 for bad input).
- **CLI error handling** — Unhandled errors in the CLI `main()` function shall be caught, logged to stderr, and cause a non-zero exit.

### 2.17 Startup Output

- **Stdout readiness** — The `Glassbox running at http://localhost:{port}` message shall be printed to stdout (not stderr), as it is parsed by the Tauri sidecar to detect when the server is ready.
- **Port conflict logging** — If the port was changed due to a conflict, the server shall log a message indicating the original and actual ports.
