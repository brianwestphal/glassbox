# Glassbox Code Summary

A map of the Glassbox codebase, written so a fresh AI session (or human)
can orient quickly without opening every file. Read this first; open
specific files only when you need detail beyond what is here.

> **Maintenance rule.** Whenever you add, remove, rename, or significantly
> restructure something in this codebase, update this file in the same
> pass. See §17 for the trigger list.

## 1. Stack at a glance

- **Runtime**: Node.js 20+
- **Language**: TypeScript (strict, ESM, `.js` extensions in imports)
- **HTTP server**: Hono + `@hono/node-server`, bound to `127.0.0.1`
- **Database**: PGLite (embedded Postgres, WASM), stored in `~/.glassbox/data/`
- **Rendering**: Custom server-side JSX runtime → HTML strings. No React.
- **Desktop shell**: Tauri v2 (Rust) wraps the Node server as a sidecar
- **Build**: tsup (server + client IIFE bundles) + sass (SCSS → CSS)
- **Dev**: tsx for direct TS execution; client assets pre-built
- **Tests**: vitest (unit + integration) + Playwright (E2E) + bash (smoke)

## 2. Top-level layout

```
glassbox/
├── src/                    # TypeScript source (server + client)
├── src-tauri/              # Rust desktop shell (Tauri v2)
├── docs/                   # Requirements (1-17) + ARCHITECTURE, tauri-*
├── tests/                  # unit/, integration/, e2e/, smoke/, fixtures/
├── scripts/                # build-sidecar.sh, release.sh, test-*.sh, etc.
├── dist/                   # Build output (cli.js, client/app.global.js, styles.css)
├── assets/                 # Static assets shipped with the app
├── CLAUDE.md               # Project rules for AI sessions
├── package.json            # npm scripts, deps, imports map (#jsx alias)
├── tsup.config.ts          # Server + client build config
├── tsconfig.json           # TS config (jsxImportSource: #jsx)
├── playwright.config.ts    # E2E runner config
└── vitest.config.ts        # Unit/integration runner config
```

## 3. `src/` directory — every file

### Top level (`src/*.ts`, `*.tsx`)

| File | Purpose |
|------|---------|
| `cli.ts` | Entry point. Parses args, picks review mode, calls git, creates/resumes review, starts server. |
| `server.ts` | Hono app bootstrap. Middleware for `reviewId`/`currentReviewId`/`repoRoot`. Static asset routes. Registers route groups. |
| `types.ts` | `AppEnv` (Hono `Env` with typed Variables). |
| `jsx-runtime.ts` | Custom JSX → HTML. Exports `SafeHtml`, `jsx`, `jsxs`, `Fragment`, `raw()`. Auto-escapes string children. |
| `icons.tsx` | SVG icon components used across server-rendered pages and client UI. |
| `channel.ts` | MCP channel server (stdio transport + local HTTP). Bridges Glassbox UI → Claude Code. Built as `dist/channel.js`. |
| `channel-config.ts` | Reads/writes `.mcp.json` entry for the channel, port file in `.glassbox/`, health check. |
| `skills.ts` | Generates the `/glassbox` skill file for Claude Code / Cursor. |
| `lock.ts` | PID-based instance lock (`~/.glassbox/glassbox.lock`). Detects and clears stale locks. |
| `debug.ts` | Debug mode flags (e.g., `--debug`, `--ai-service-test`). |
| `demo.ts` | Pre-configured demo scenarios (invoked via `--demo:N`). Bypasses git + locking. |
| `update-check.ts` | Daily npm update check against the registry (npm/yarn/pnpm/bun detection). |
| `review-update.ts` | Refreshes diffs for an existing review when HEAD is the same but the working tree changed. Runs fuzzy annotation migration. |
| `global-config.ts` | Single source of truth for `~/.glassbox/config.json` and the `~/.glassbox/` dir. Exports `readGlobalConfig()` and `updateGlobalConfig(mutator)` (read-modify-write under one call so concurrent writers can't clobber unrelated keys). All other modules go through this — channel toggle, share prompt, theme selection, AI preferences, API keys. |

### `src/routes/` — HTTP handlers

| File | Purpose |
|------|---------|
| `pages.tsx` | Server-rendered HTML routes (`/`, `/file/:fileId`, `/review/:reviewId`, `/history`). Returns `SafeHtml` via JSX. |
| `api.ts` | Aggregator that mounts the per-concern sub-routers under `/api/*`. |
| `api/reviews.ts` | Review CRUD + completion / reopen / refresh / delete-completed / delete-all + gitignore prompt. |
| `api/files.ts` | Files list, file detail, file status, file reveal in OS file manager. |
| `api/annotations.ts` | Annotation CRUD, move, keep, stale-handling endpoints. |
| `api/outline.ts` | `/outline/:fileId` and `/symbol-definition` go-to-definition repo scan. |
| `api/context.ts` | `/context/:fileId` line-range fetch for hunk expansion. |
| `api/project-settings.ts` | `.glassbox/settings.json` read/write (per-repo `appName`). |
| `api/image.ts` | Image diff: `/image/:fileId/metadata` and `/image/:fileId/:side` with SVG rasterization. |
| `api/share-prompt.ts` | Share prompt state / dismiss / tick (uses `global-config.ts`). |
| `ai-api.ts` | Router that mounts ai-config + ai-analysis handlers under `/api/ai/*`. |
| `ai-analysis.ts` | `POST /analyze` dispatch (risk/narrative/guided), progress polling, cancellation. |
| `ai-config.ts` | `/config`, `/models`, `/key-status`, `/key`, `/preferences`. |
| `theme-api.ts` | CRUD + active theme for `/api/themes/*`. |
| `channel-api.ts` | `/status`, `/enable`, `/disable`, `/trigger`, `/claude-check`. |

### `src/components/` — server-rendered JSX pieces

| File | Purpose |
|------|---------|
| `layout.tsx` | Root HTML document (`<!doctype>`, `<head>`, `<body>`). Injects theme CSS vars. |
| `diffView.tsx` | Diff rendering (split + unified hunks, syntax highlighting integration). |
| `fileList.tsx` | Sidebar file list with status + annotation badges. |
| `reviewShell.tsx` | Shared layout used by both `/` and `/review/:reviewId` — sidebar (header, filter, file list, footer slot), diff toolbar, image toolbar, navigation bar. Routes only differ in the footer (Complete vs. Reopen). |
| `imageDiff.tsx` | Image diff view (metadata / difference / slice modes). |
| `reviewHistory.tsx` | Review history page table. |

### `src/db/` — database layer (raw SQL, no ORM)

| File | Purpose |
|------|---------|
| `connection.ts` | PGLite init, schema apply, corrupt-DB recovery, `addColumnIfMissing` migrations. Exported `setDataDir`, `getDb`. |
| `schema.ts` | `SCHEMA_CORE_SQL` (reviews, review_files, annotations) and `SCHEMA_AI_SQL` (ai_analyses, ai_file_scores, user_preferences). Single source of truth. |
| `queries.ts` | CRUD for reviews, review_files, annotations. |
| `ai-queries.ts` | CRUD for ai_analyses, ai_file_scores, user_preferences. |

See §6 for the schema itself.

### `src/git/` — git integration

| File | Purpose |
|------|---------|
| `diff.ts` | `getFileDiffs(mode, cwd)`, `parseDiff()`, mode → `git` argv builder. Also lists untracked files for uncommitted mode and walks all files for `--all`. |
| `repo.ts` | `getRepoRoot`, `getRepoName`, `getHeadCommit`, `isGitRepo`. |
| `types.ts` | `ReviewMode`, `FileDiff`, `DiffHunk`, `DiffLine`. |
| `image.ts` | Image side retrieval from git (old/new), binary detection, format identification. |
| `image-metadata.ts` | Parse image headers (PNG IHDR, JPEG SOF/JFIF, GIF, WebP VP8/VP8L/VP8X) — no native deps. |
| `svg-rasterize.ts` | Rasterize SVG → PNG via `@resvg/resvg-wasm` for SVG "Rendered" mode. |
| `parseDiffData.ts` | Pure helper to parse `review_files.diff_data` JSON into `FileDiff` (or `null` for missing/corrupt). Safe to import from both server and client bundles. |

### `src/ai/` — AI analysis subsystem

| File | Purpose |
|------|---------|
| `models.ts` | Curated platform/model list. **Keep current daily** (Anthropic/OpenAI/Google releases). Context windows, ENV var names. |
| `config.ts` | Load/save `~/.glassbox/config.json` (platform, model, guided settings, share prompt, channel enabled, cumulative open time). |
| `api-keys.ts` | Key resolution chain: env var → OS keychain → base64 in config file. Save/delete, source detection. |
| `keychain.ts` | OS keychain wrappers: macOS `security`, Linux `secret-tool`, Windows `cmdkey`. |
| `client.ts` | Unified HTTP client. `sendAIRequest(config, system, messages)` dispatches to Anthropic / OpenAI / Google. Returns content + token counts. |
| `context-builder.ts` | Build per-file context payloads respecting a char budget. Handles summarization when a file's diff is too large. |
| `batch-planner.ts` | Split files into token-budgeted batches for a given model. |
| `batch-runner.ts` | Execute batches sequentially, update progress, honor cancellation. |
| `analyze-risk.ts` | Risk orchestrator. Dimensions: security, correctness, error-handling, maintainability, architecture, performance. Aggregate = max. |
| `analyze-narrative.ts` | Narrative orchestrator. Produces a reading order + per-file rationale + walkthrough notes. |
| `analyze-guided.ts` | Guided review orchestrator (topic-driven educational notes). |
| `guided-review.ts` | Builds guided-review topic suffix text injected into risk/narrative prompts. |
| `shared.ts` | Utilities: JSON extraction, "need more context" detection, prompt formatting helpers. |
| `mock.ts` | `--ai-service-test` mock responses for all three analysis types (no network). |

### `src/themes/`

| File | Purpose |
|------|---------|
| `built-in.ts` | `BUILT_IN_THEMES` array and `ThemeColors` type. Lists all color variables (backgrounds, text, accent, semantic, diff, gutter, border). |
| `config.ts` | Active theme persistence (`~/.glassbox/config.json`), custom theme CRUD in `~/.glassbox/themes/*.json`, auto-copy-on-edit for built-ins. |

### `src/export/`

| File | Purpose |
|------|---------|
| `generate.ts` | Generates `.glassbox/latest-review.md` (overwritten) and `review-{id}.md` (archived). Includes category summary table, "Items to Remember" block, grouped-by-file annotations, and "Instructions for AI Tools" section. Also handles gitignore prompt logic. |
| `auto-export.ts` | Debounced (2s) regeneration triggered by annotation writes. Fired immediately on review completion. |

### `src/outline/`

| File | Purpose |
|------|---------|
| `parser.ts` | `parseOutline(content, filePath)` → `OutlineSymbol[]`. Regex-based for brace languages (JS/TS/Java/Go/Rust/C-family) and indent-based (Python/Ruby). Powers the outline panel and go-to-definition. |

### `src/utils/`

| File | Purpose |
|------|---------|
| `charDiff.ts` | Character-level diff highlighting for intra-line changed words. |
| `escapeHtml.ts` | HTML entity escaping used by the JSX runtime. |
| `resolveReviewId.ts` | Hono helper: prefers `?reviewId=` query, falls back to middleware-provided current review. |
| `validate.ts` | `checkEnum<T>()` — string-enum membership check returning `{ ok }` or `{ error }`. Used at all `/api` validation sites. |

### `src/client/` — browser bundle

**Entry + shared infrastructure:**

| File | Purpose |
|------|---------|
| `app.tsx` | Bundle entry. Boots debug, AI sorting, sidebar, diff view, annotation events, review controls. |
| `state.ts` | Shared types, `defaultAnalysisModeState()`, and `CATEGORIES` constants. No runtime state. |
| `stores/index.ts` | Reactive state via kerfjs `defineStore`: `reviewStore` (reviewId, currentFileId, files, fileOrder, annotationCounts, staleCounts, filterText), `diffViewStore` (diffMode, wrap, whitespace, image mode, svg mode, highlight, collapsedFolders), `aiStore` (sortMode, scores, analysis states, fileNotes, guidedNotes, configured/enabled flags), `dragStore`. Computed `filteredFiles`, `aiEnabled`. `getAnalysisModeState(mode)` helper. |
| `api.ts` | `api<T>(path, opts)` fetch helper. Auto-appends `reviewId`, auto-serializes body. Never pre-stringify. |
| `dom.ts` | `toElement(jsx \| string)` — the only way client code should produce DOM nodes. No `document.createElement`. |
| `tauri.ts` | Tauri `invoke()` wrappers (check/install CLI, update check, install update). |
| `themes.ts` | Apply active theme colors to `document.documentElement`, switch themes live. |
| `guided.ts` | Guided review topic selection + state. |
| `share.ts` | OS share sheet (`navigator.share`) with clipboard fallback. |
| `history.tsx` | Separate entry for `/history` page (built as `history.global.js`). |

**Client subfolders:**

| Folder | Files | Purpose |
|--------|-------|---------|
| `diff/` | `mode.ts`, `selection.ts`, `toolbar.tsx`, `highlight.ts`, `hunkExpander.tsx`, `lineClicks.ts`, `dragDrop.ts`, `splitSync.ts`, `navStack.ts`, `find.tsx`, `goToDefinition.tsx`, `outline.tsx`, `aiNotes.tsx`, `imageDiff/` (`index.ts`, `zoom.ts`, `sliceTool.ts`, `metadata.ts`) | Everything in the diff panel: split/unified modes, wrap, whitespace, syntax highlighting, line clicks, drag-and-drop annotations, split-column scroll sync, navigation stack, Cmd+F find, Cmd+click go-to-definition, outline panel, AI inline notes. Image diff is split by concern under `imageDiff/` (orchestration / zoom-pan via `WeakMap` / slice tool / metadata loader). |
| `sidebar/` | `fileTree.tsx`, `sortMode.tsx`, `riskView.tsx`, `narrativeView.tsx`, `controls.ts` | File tree, sort-mode segmented control, risk-sorted view with badges, narrative-sorted view with positions, filter/resize/keyboard wiring. |
| `annotations/` | `categories.tsx`, `form.tsx`, `events.tsx`, `render.tsx` | Category badge + picker, create/edit form, event wiring (create/delete/move/reclassify), inline rendering on diff lines. |
| `review/` | `modal.tsx`, `progress.tsx` | Completion modal (with optional "Send to Claude" when channel is on), gitignore prompt, progress bar. |
| `settings/` | `dialog.tsx`, `tabContext.ts`, `generalTab.tsx`, `profileTab.tsx`, `experimentalTab.tsx`, `updatesTab.tsx`, `themeEditor.tsx`, `themeManager.tsx` | Tabbed settings modal. Each tab is a `Tab` registry entry (`{ id, label, icon, enabled?, render, bind }`) sharing a single `TabContext` defined in `tabContext.ts`. Dialog iterates the registry — adding a new tab is a one-line change. Auto-save on change; no Save/Cancel. AI config lives under Experimental. |
| `styles/` | `_variables.scss`, `_base.scss`, `_sidebar.scss`, `_diff.scss`, `_annotations.scss`, `_buttons.scss`, `_modal.scss`, `_scrollbar.scss`, `_highlight.scss`, `_history.scss`, `_ai-sort.scss`, `_image-diff.scss`, `_settings.scss`, `_update-banner.scss` | SCSS partials imported by `styles.scss`. |

### `src-tauri/src/` — Rust desktop shell

| File | Purpose |
|------|---------|
| `main.rs` | Entry; calls `glassbox_lib::run()`. |
| `lib.rs` | Everything: setup, sidecar spawn + PID tracking + exit cleanup, CLI install/check commands (macOS symlink / Linux symlink / Windows .cmd + PATH), updater commands, native Find menu wiring. See `docs/tauri-architecture.md` for the full picture. |

Also: `tauri.conf.json`, `Cargo.toml`, `Entitlements.plist`, `loading/` (spinner + welcome HTML), `resources/` (CLI launcher scripts), `binaries/` (downloaded Node.js per target), `server/` (bundled server + client + `node_modules`).

## 4. Server lifecycle

```
cli.ts: parseArgs()
  → chdir(--project-dir) if set
  → setDataDir() → init PGLite
  → lock.acquire() (skipped in demo mode)
  → checkForUpdates() once per day
  → ensureSkills()  (writes /glassbox skill)
  → getFileDiffs(mode) from git
  → branch:
      existing in-progress + same HEAD → updateReviewDiffs()
      --resume + different HEAD       → reopen latest in-progress
      otherwise                       → createReview() + addReviewFile() ×N
  → startServer(port, reviewId, repoRoot, options)

server.ts: startServer()
  → Hono<AppEnv>
  → middleware: inject reviewId / currentReviewId / repoRoot
  → /static/{app.js, history.js, styles.css}  (cache: no-cache)
  → mount route groups: /api, /api/ai, /api/themes, /api/channel, /
  → tryServe() with 20-port fallback (unless --strict-port)
  → stdout: "Glassbox running at http://localhost:{port}"  ← Tauri reads this
  → open browser (unless --no-open)
  → if channelEnabled: registerChannel(dataDir)
```

Graceful shutdown: Tauri's `RunEvent::Exit` kills the sidecar process group
(SIGTERM on Unix, `taskkill /T /F` on Windows). Force-kill orphans PGLite's
`postmaster.pid`; it must be removed before next launch.

## 5. Routes catalog

### Pages (HTML)

| Path | Handler | Purpose |
|------|---------|---------|
| `GET /` | `routes/pages.tsx` | Main review UI (sidebar + diff viewer) |
| `GET /file/:fileId` | `routes/pages.tsx` | File fragment (loaded into content pane) |
| `GET /review/:reviewId` | `routes/pages.tsx` | View a past review (read-only or reopenable) |
| `GET /history` | `routes/pages.tsx` | Review history listing |
| `GET /static/styles.css` | `server.ts` | Built CSS |
| `GET /static/app.js` | `server.ts` | Built client IIFE |
| `GET /static/history.js` | `server.ts` | History page IIFE |

### `/api/*` (core — `routes/api.ts`)

Reviews: `GET /reviews`, `GET /review`, `POST /review/complete`,
`POST /review/reopen`, `DELETE /review/:id`,
`POST /reviews/delete-completed`, `POST /reviews/delete-all`.

Files: `GET /files`, `GET /files/:fileId`, `PATCH /files/:fileId/status`.

Annotations: `POST /annotations`, `PATCH /annotations/:id`,
`DELETE /annotations/:id`, `PATCH /annotations/:id/move`,
`POST /annotations/:id/keep`,
`POST /annotations/stale/delete-all`, `POST /annotations/stale/keep-all`,
`GET /annotations/all`.

Context/outline/project: `GET /context/:fileId`, `GET /outline/:fileId`,
`GET /project-settings`, `PATCH /project-settings`,
`POST /gitignore/add`, `POST /gitignore/dismiss`.

### `/api/ai/*` (`routes/ai-api.ts` → `ai-analysis.ts`, `ai-config.ts`)

`GET /config`, `POST /config`, `GET /models`, `GET /key-status`,
`POST /key`, `DELETE /key`,
`POST /analyze`, `GET /analyze/status`, `POST /analyze/cancel`,
`GET /preferences`, `POST /preferences`,
plus internal debug endpoints (`/debug-status`, `/debug-log`) and
guided-review config endpoints.

### `/api/themes/*` (`routes/theme-api.ts`)

`GET /themes`, `POST /themes`, `PATCH /themes/:id`, `DELETE /themes/:id`,
`GET /themes/active`, `POST /themes/active`.

### `/api/channel/*` (`routes/channel-api.ts`)

`GET /status`, `POST /enable`, `POST /disable`, `POST /trigger`,
`GET /claude-check`.

## 6. Database schema

See `src/db/schema.ts` for the authoritative SQL. Quick reference:

**Core tables:**

- `reviews(id, repo_path, repo_name, mode, mode_args, head_commit, status, created_at, updated_at)`
- `review_files(id, review_id →reviews, file_path, status, diff_data, created_at)`
  — `diff_data` is a **JSON-serialized `FileDiff`** (hunks, paths, binary flag)
- `annotations(id, review_file_id →review_files, line_number, side, category, content, is_stale, original_content, created_at, updated_at)`

**AI tables:**

- `ai_analyses(id, review_id →reviews, analysis_type, status, error_message, progress_completed, progress_total, created_at, updated_at)`
- `ai_file_scores(id, analysis_id →ai_analyses, review_file_id, file_path, sort_order, aggregate_score, rationale, dimension_scores, notes, created_at)`
  — `dimension_scores` and `notes` are **JSON strings**
- `user_preferences(id='singleton', sort_mode, risk_sort_dimension, show_risk_scores, ignore_whitespace, svg_view_mode, last_image_mode)` — one row

Foreign keys cascade-delete. Indexes: `idx_review_files_review`,
`idx_annotations_file`, `idx_ai_analyses_review`,
`idx_ai_file_scores_analysis`.

## 7. JSX runtime

`src/jsx-runtime.ts` produces `SafeHtml` (a wrapper around an HTML string).
Configured via:

- `tsconfig.json`: `"jsx": "react-jsx"`, `"jsxImportSource": "#jsx"`
- `package.json` imports map: `"#jsx/jsx-runtime": "./src/jsx-runtime.ts"`
- `tsup.config.ts`: esbuild alias resolves `#jsx/jsx-runtime` at build time
  for **both** server and client

Rules:

- Components return `SafeHtml` (aliased as `JSX.Element`).
- String children are auto-escaped (via `utils/escapeHtml.ts`).
- Use `raw(html)` to inject pre-escaped HTML (e.g., highlighted code).
- In client code, cross into DOM only at the last moment via
  `toElement(<…/>)` from `src/client/dom.ts`. Never use `document.createElement`.

## 8. Client bundle

Two IIFE bundles from `src/client/`:

- `dist/client/app.global.js` — main app (from `app.tsx`)
- `dist/client/history.global.js` — history page (from `history.tsx`)

`app.tsx` wires up, in order: debug probe → AI sort state (loads prefs,
checks config) → sidebar file tree → diff view → annotation events →
completion modal → share prompt/button → Tauri integration hooks.

All server communication goes through `api()` in `src/client/api.ts`, which
injects the `reviewId` query param and serializes request bodies. **Never
pre-stringify** the body — `api()` already does it.

## 9. AI subsystem

Three analysis flavors share the same machinery:

```
user triggers /api/ai/analyze
  → ai-analysis.ts loads AIConfig + resolves API key
  → creates ai_analyses row (status=pending)
  → batch-planner.ts splits review files into token-budgeted batches
  → batch-runner.ts runs batches sequentially, updating progress_*
      each batch:
        context-builder.ts → formatted diff context
        analyze-{risk|narrative|guided}.ts → prompt + sendAIRequest
        client.ts.sendAIRequest → Anthropic/OpenAI/Google HTTP
        shared.ts.extractJSON → parse structured response
        write ai_file_scores rows
  → final status: completed | failed (error_message) | canceled
```

Cancellation is cooperative via `cancelledAnalyses` in `ai-analysis.ts`;
switching between risk and narrative cancels the other. Caching: if a file
is unchanged across runs, prior scores carry forward (see §7.6 of
requirements).

API keys resolve in this order: env var (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GEMINI_API_KEY`) → OS keychain → base64 in
`~/.glassbox/config.json`. Keys are never logged or echoed back.

Mock mode (`--ai-service-test`) bypasses `sendAIRequest` entirely and
returns fixtures from `src/ai/mock.ts`.

## 10. Themes

Live CSS-variable-based theming. Flow:

1. Built-in themes defined in `src/themes/built-in.ts`.
2. Active theme stored in `~/.glassbox/config.json` under `theme.active`.
3. Custom themes live in `~/.glassbox/themes/{id}.json`.
4. On load, `routes/pages.tsx` reads active colors and injects a `<style>`
   with CSS custom properties on `:root`.
5. Client `themes.ts` applies changes live via `document.documentElement.style`.
6. Editing a built-in theme auto-copies it to a custom theme before edit
   (spec FR-15.3 / `src/themes/config.ts`).

Theme manager + editor UI live under `src/client/settings/`.

## 11. Export

`src/export/generate.ts` produces two files on each export:

- `.glassbox/latest-review.md` — always the current state (overwritten)
- `.glassbox/review-{id}.md` — archived copy

Auto-export (`auto-export.ts`) debounces writes at **2s** after any
annotation mutation. Completion exports immediately.

Format includes: header (repo/mode/date/counts), category summary table,
Items to Remember section (from `remember` category), per-file grouped
annotations with line number + category, and an Instructions for AI Tools
section explaining category semantics.

## 12. Channel (MCP → Claude Code)

- `src/channel.ts` is built as `dist/channel.js` and spawned by Claude Code
  via `.mcp.json` (key: `glassbox-channel`).
- Communicates with Claude over **stdio using MCP**; exposes a local HTTP
  endpoint whose port is written to `.glassbox/channel-port`.
- `channel-config.ts` manages the `.mcp.json` entry and health checks.
- `routes/channel-api.ts` powers the UI toggle and the "Send to Claude"
  button on the completion modal (FR-17.4).
- Minimum Claude Code version: **v2.1.80+** (enforced via `/claude-check`).
- External dep: `@modelcontextprotocol/sdk` (kept external in tsup — see §14).

## 13. Git integration

`src/git/diff.ts` maps review modes to argv:

| Mode | git invocation |
|------|----------------|
| uncommitted | `git diff HEAD` + `git ls-files --others --exclude-standard` |
| staged | `git diff --cached` |
| unstaged | `git diff` |
| commit `<sha>` | `git diff <sha>~1 <sha>` |
| range `<from>..<to>` | `git diff <from>..<to>` |
| branch `<name>` | `git diff <name>...HEAD` |
| files `<patterns>` | `git diff HEAD -- <patterns>` |
| all | custom walk of all tracked files |

All invocations use argv arrays (`spawnSync` / `execFileSync`) — never
string interpolation into a shell (FR-14.3). Binary detection: git's own
indicator plus a null-byte scan of the first 8 KB.

## 14. Build

Scripts (`package.json`):

- `build` — `tsup` server + client bundles
- `build:client` — client JS + CSS only
- `dev` — build client, run via `tsx`
- `dev:server` — dev with `--no-open --strict-port`
- `tauri:dev` / `tauri:build` — desktop dev / full desktop build
- `test`, `test:watch`, `test:all`, `test:e2e`, `test:smoke`, `lint`
- `release` — version bump + publish (see `scripts/release.sh`)

`tsup.config.ts` produces:

- `dist/cli.js` — ESM, Node 20 banner (`#!/usr/bin/env node`). External:
  `@electric-sql/pglite`, `hono`, `@hono/node-server`, `@resvg/resvg-wasm`,
  `@modelcontextprotocol/sdk`.
- `dist/channel.js` — channel server entry (also ESM, similar externals).
- `dist/client/app.global.js` — IIFE, es2020, minified.
- `dist/client/history.global.js` — IIFE for the history page.
- `dist/client/styles.css` — compiled + compressed from SCSS.

Shared JSX alias (`#jsx/jsx-runtime`) resolves to `src/jsx-runtime.ts` in
both builds.

**When adding a new external server dep**, update **three** places (see
CLAUDE.md): `tsup.config.ts` noExternal regex, `scripts/build-sidecar.sh`
package copy loop, and CLAUDE.md's current-externals list.

## 15. Tests

```
tests/
├── unit/         # vitest; mocks at boundaries (db, fs, network)
├── integration/  # vitest; cross-module, in-memory DB
├── e2e/          # Playwright; Chromium; real server in demo mode on 4183
├── smoke/        # bash CLI smoke tests
├── fixtures/     # shared test data
└── helpers/      # db.ts test helpers
```

Coverage pipeline (`scripts/test-all.sh`) merges three lcov streams:
server V8 (via `NODE_V8_COVERAGE`), browser V8 (via Playwright
`page.coverage` + esbuild source maps), and vitest V8. `genhtml` produces
the combined HTML report.

See `docs/testing/` (if present) and `CLAUDE.md` → Testing Philosophy for
rules ("every feature has both unit and E2E coverage").

## 16. Tauri desktop

Three launch flows (full detail in `docs/tauri-architecture.md`):

1. **Double-click app** (no `--project-dir`) → `welcome.html` CLI
   install wizard.
2. **macOS CLI** (`glassbox`) → CLI script starts the Node server in the
   terminal context (JIT + filesystem OK), creates a stub `.app` for
   Dock identity, passes the URL via `/tmp/glassbox-server-{hash}.info`
   to the Tauri binary.
3. **Direct binary with `--project-dir`** → Rust spawns the sidecar,
   reads "running at" from stdout, navigates the webview.

CLI install locations: `/usr/local/bin/glassbox` (macOS symlink),
`~/.local/bin/glassbox` (Linux symlink),
`%LOCALAPPDATA%\Programs\glassbox\glassbox.cmd` (Windows copy + user PATH).

Updates: `tauri-plugin-updater` reads `latest.json` from GitHub Releases
on every launch. Opt-in install only. Public key embedded in
`tauri.conf.json`. CI (`.github/workflows/release-desktop.yml`) builds
signed/notarized artifacts on `v*` tags.

## 17. Maintenance rules

Update `docs/ai/code-summary.md` in the same pass whenever you:

1. Add, remove, or rename a file under `src/` or `src-tauri/src/`.
2. Add, remove, or restructure a subfolder under `src/client/`,
   `src/routes/`, `src/ai/`, `src/git/`, `src/db/`, `src/themes/`,
   `src/export/`, `src/outline/`, `src/utils/`, or `src/components/`.
3. Add or remove an HTTP route (page, API, AI, theme, channel).
4. Change the database schema (columns, tables, indexes).
5. Add a new AI platform, analysis type, or annotation category.
6. Change the build pipeline (tsup config, external deps,
   client/server bundle split, new script in `scripts/`).
7. Add or remove a client subsystem (new folder under `src/client/`).
8. Change the Tauri launch flow or add/remove Rust commands.
9. Change the channel / MCP integration shape.

Also keep `CLAUDE.md`'s file lists and external-dep list in sync — the
two documents intentionally overlap.

## 18. "Where do I look to…" reverse index

| Task | Start here |
|------|------------|
| Add a new API endpoint | Pick the right sub-router under `src/routes/api/` (or add a new one and mount it in `src/routes/api.ts`); for AI/themes/channel use `src/routes/ai-*.ts`, `theme-api.ts`, `channel-api.ts`. Register a brand-new group in `src/server.ts`. |
| Add a new page/route | `src/routes/pages.tsx`; register in `src/server.ts`. |
| Change the DB schema | `src/db/schema.ts` (tables/indexes) + a migration in `src/db/connection.ts` (`addColumnIfMissing` pattern). Query code in `src/db/queries.ts` or `ai-queries.ts`. |
| Add an annotation category | `src/client/state.ts` (CATEGORIES), `src/client/annotations/categories.tsx` (UI), `src/routes/api/annotations.ts` (`VALID_CATEGORIES`), `src/export/generate.ts` (export semantics). Update `docs/5-annotations.md` + `docs/6-export.md`. |
| Add a CLI option | `src/cli.ts` `parseArgs()` switch; document in `docs/2-cli-and-server.md`. |
| Add an AI platform | `src/ai/models.ts` (platform + models + env key), `src/ai/client.ts` (HTTP dispatch), `src/ai/api-keys.ts` (key source mapping), `src/ai/keychain.ts` (if new keychain conventions). Update `docs/7-ai-analysis.md`. |
| Add a theme | `src/themes/built-in.ts` (built-in), or create `~/.glassbox/themes/*.json` (custom). All vars from `ThemeColors` must be present. |
| Change export format | `src/export/generate.ts`. Update `docs/6-export.md`. |
| Add a diff mode/view | `src/client/diff/` (new module), wire into `src/client/diff/mode.ts` and `toolbar.tsx`. Server rendering lives in `src/components/diffView.tsx`. |
| Add a new image diff mode | `src/components/imageDiff.tsx` + `src/client/diff/imageDiff/` (`index.ts` orchestration, `zoom.ts`, `sliceTool.ts`, `metadata.ts`). |
| Tweak go-to-definition | `src/outline/parser.ts` (regex rules) and `src/client/diff/goToDefinition.tsx` (wiring). |
| Add a SCSS partial | Create `src/client/styles/_thing.scss`, `@use` it from `src/client/styles.scss`. |
| Add client state | `src/client/stores/index.ts` — pick the matching store (`reviewStore` / `diffViewStore` / `aiStore` / `dragStore`) or add a new one. Types in `state.ts`. |
| Add a Tauri command | `src-tauri/src/lib.rs` (`#[tauri::command]` + `invoke_handler`). Call from `src/client/tauri.ts`. |
| Change the sidecar build | `scripts/build-sidecar.sh` + `tsup.config.ts` + CLAUDE.md external-deps list. |
| Add an MCP-channel capability | `src/channel.ts` (MCP handler), `src/channel-config.ts` (if `.mcp.json` shape changes), `src/routes/channel-api.ts` (UI-facing endpoint). Update `docs/17-claude-channel.md`. |

## Related reading

- `CLAUDE.md` — project rules, build/test commands, and coding conventions.
- `docs/ai/requirements-summary.md` — synthesized view of every
  requirements doc.
- `docs/ARCHITECTURE.md` — higher-level architecture narrative.
- `docs/tauri-architecture.md` — Tauri sidecar deep dive.
- `docs/tauri-setup.md` — certificates, signing keys, GitHub secrets.
- `docs/1-review-workflow.md` … `docs/17-claude-channel.md` — numbered
  functional / non-functional requirements.
