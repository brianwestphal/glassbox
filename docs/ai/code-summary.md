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
- **Rendering**: kerfjs JSX runtime (no React). Server-side → HTML strings via `SafeHtml`; client-side reactivity via `mount()` / `delegate()` / `signal()` / `defineStore`.
- **Desktop shell**: Tauri v2 (Rust) wraps the Node server as a sidecar
- **Build**: tsup (server + client IIFE bundles) + sass (SCSS → CSS)
- **Dev**: tsx for direct TS execution; client assets pre-built
- **Tests**: vitest (unit + integration) + Playwright (E2E) + bash (smoke)

## 2. Top-level layout

```
glassbox/
├── src/                    # TypeScript source (server + client)
├── src-tauri/              # Rust desktop shell (Tauri v2)
├── docs/                   # Requirements (1-19) + ARCHITECTURE, tauri-*
├── tests/                  # unit/, integration/, e2e/, smoke/, fixtures/
├── scripts/                # build-sidecar.sh, release.sh, test-*.sh, demo/ (README hero capture), release/ (GH release download summary + asset renaming SSOT)
├── dist/                   # Build output (cli.js, client/app.global.js, styles.css)
├── assets/                 # Static assets shipped with the app
├── CLAUDE.md               # Project rules for AI sessions
├── package.json            # npm scripts, deps
├── tsup.config.ts          # Server + client build config
├── tsconfig.json           # TS config (jsxImportSource: kerfjs)
├── playwright.config.ts    # E2E runner config
└── vitest.config.ts        # Unit/integration runner config
```

## 3. `src/` directory — every file

### Top level (`src/*.ts`, `*.tsx`)

| File | Purpose |
|------|---------|
| `cli.ts` | Entry point. Parses args, picks review mode, calls git, creates/resumes review, starts server. |
| `cli-difftool.ts` | Standalone `glassbox-difftool` bin entry — bridges `git difftool` into a Glassbox review. Built to `dist/cli-difftool.js` and shipped via `package.json`'s `"bin"` map. **`--dir-diff` (any target):** the **blocking** path — dereferences git's symlinked snapshot dirs into a temp tree (git uses symlinks on the right side of `--dir-diff`) and launches `glassbox --diff` (desktop launcher shim with `GLASSBOX_DIFFTOOL_BLOCK=1`, or sibling `cli.js`); blocking keeps the temp tree alive for the whole session. **Per-file (doc 19, accumulating):** a **thin client** — reads `$LOCAL`/`$REMOTE` content into memory (before git deletes the temp files), discovers-or-starts a single accumulating session (`src/git/difftool-client.ts`), appends the file (labeled by git's repo-relative `$MERGED` path when the registered cmd passes it, else the working-tree basename — GB-864), and returns immediately, except on the last file (`GIT_DIFF_PATH_COUNTER == GIT_DIFF_PATH_TOTAL`) where it holds so `git difftool` stays attached until "Done"/tab-or-window-close. The session start differs by target: **browser** spawns `cli.js --difftool-serve` (opens a tab); **desktop** launches the launcher shim in `--difftool-serve` mode so the review opens in one Tauri window and later invocations append to it (GB-861 — closing the window kills the sidecar, ending the session). Pure decisions live in `src/git/difftool-launch.ts`. |
| `server.ts` | Hono app bootstrap. Middleware for `reviewId`/`currentReviewId`/`repoRoot`. Static asset routes. Registers route groups. |
| `types.ts` | `AppEnv` (Hono `Env` with typed Variables). |
| (JSX runtime) | Provided by **kerfjs** (`kerfjs/jsx-runtime`). `SafeHtml` / `raw()` / `Fragment` / `each` / `morph` / `mount` / `delegate` / `signal` / `effect` / `computed` / `defineStore` are all imported from `'kerfjs'`. Auto-escapes string children. Shared between server (SSR via `.toString()`) and client (`mount()`-driven reactivity). |
| `icons.tsx` | SVG icon components used across server-rendered pages and client UI. |
| `channel.ts` | MCP channel server (stdio transport + local HTTP). Bridges Glassbox UI → Claude Code. Built as `dist/channel.js`. |
| `channel-config.ts` | Reads/writes `.mcp.json` entry for the channel, port file in `.glassbox/`, health check. |
| `skills.ts` | Generates the `/glassbox` skill file for Claude Code / Cursor. |
| `review-notes/` | AI-authored review notes (doc 20) — P1. `types.ts` (note-kind vocab + constants), `sarif.ts` (note → SARIF 2.1.0 `result` mapping; standard fields + one custom `ext-ai-tool-confidence`), `store.ts` (path-sharded `.pr-notes/notes/<src>.NNNNNN.sarif` layout, 10k-cap roll-over, run-per-(producer,commit) grouping, snippet+fingerprint, lossless read-modify-write; plus guid-keyed `removeNote`/`updateNote` and a dedup `coalesceFile`/`coalesceAll`), `cli.ts` (`runNoteCli` — `glassbox note add` / `update` / `remove` / `coalesce` / `instructions`), `instructions.ts` (the canonical inbound AI-instructions contract, printed by `glassbox note instructions` for orchestrators to inject — doc 20 §20.4), `view.ts` + `loadReviewNotesForFile` (store.ts) — the P2 **reader/render** path: flatten `.pr-notes/` SARIF into diff-anchored view items that `DiffView` server-renders full-width below their line (`ReviewNoteRows`, styled `ai-note-review` + per-kind badge), flow-broken in split like annotations. `reanchor.ts` (`reanchorReviewNotes`) — P3: re-matches each note's authored snippet against the current diff at load (moves shifted notes, flags vanished ones stale → "outdated" badge), mirroring the human stale matcher. `/file/:id` loads + re-anchors them (demo serves illustrative notes incl. a stale one). Note bodies render as markdown via `src/utils/noteMarkdown.ts` (`renderNoteMarkdown` — safe escape-first inline renderer, shared with `client/diff/aiNotes.tsx`). **Artifacts** (P4): `--artifact` writes SARIF `result.attachments`; `loadReviewNotesForFile` reads text/diagram-source artifact content (path-contained, size-capped, binary-skipping) and `ReviewNoteRows` renders it as a collapsible code block (Mermaid live-render + image artifacts are follow-ups). `format.ts` (`reviewNotesPromptSection` / `reviewNotesExportSection`) — P5: folds notes into the AI-analysis prompt (`runAnalysisBatch` in `ai/shared.ts`, informing risk/narrative/guided) and into the `latest-review.md` export (`export/generate.ts`). **Threading**: note rows carry their `guid` (`data-note-id`) + a Reply button; a reply is a human annotation linked by the nullable `annotations.reply_to_note_id` column (migrated in `db/connection.ts`), tagged "↳ reply" in `diffView.tsx` / `annotations/render.tsx` and **nested beneath their note** (`repliesByNote` → `ReviewNoteRows`; orphan replies fall back to line rendering; the shared `AnnotationItem` component renders both). **Stale keep/discard** (GB-907): a stale note row gets Keep (client dismiss) / Discard buttons; Discard hits `DELETE /api/review-notes/:guid` (`src/routes/api/review-notes.ts` + `src/api/review-notes.ts`) → `removeNote`. Dispatched from `cli.ts` (the `note` subcommand intercepts before normal arg parsing). |
| `lock.ts` | PID-based instance lock (`~/.glassbox/glassbox.lock`). Detects and clears stale locks. |
| `debug.ts` | Debug mode flags (e.g., `--debug`, `--ai-service-test`). |
| `demo.ts` | Pre-configured demo scenarios (invoked via `--demo:N`). Bypasses git + locking. Includes one binary **image diff** (`src-tauri/icons/128x128.png`, modeled as a rename from `64x64.png`) so the image comparison modes — and the GB-823 slice-tool e2e — have real coverage; demo mode resolves to "uncommitted", so the image bytes are served from git HEAD / the working tree. |
| `update-check.ts` | Daily npm update check against the registry (npm/yarn/pnpm/bun detection). |
| `review-update.ts` | Refreshes diffs for an existing review when HEAD is the same but the working tree changed. Runs fuzzy annotation migration. |
| `global-config.ts` | Single source of truth for `~/.glassbox/config.json` and the `~/.glassbox/` dir. Exports `readGlobalConfig()` and `updateGlobalConfig(mutator)` (read-modify-write under one call so concurrent writers can't clobber unrelated keys). All other modules go through this — channel toggle, share prompt, theme selection, AI preferences, API keys. |

### `src/api/` — typed API layer (shared by client + server)

| File | Purpose |
|------|---------|
| `_runner.ts` | Client-only runtime helper: re-exports `api()` from `client/api.ts` and a tiny `qs()` query-string builder. Per-resource caller functions go through this. |
| `index.ts` | Aggregator. Re-exports every per-resource module (`export *`) so callers can `import { createAnnotation } from '../api/index.js'` AND get a flat `apis` namespace (`apis.createAnnotation({...})`) for discoverability. |
| `annotations.ts` | Req/Resp types + callers for `/annotations/*` (create / update / delete / move / keep / stale-delete-all / stale-keep-all / list-all). |
| `context.ts` | `GetContextLinesReq/Resp` + `getContextLines()` for hunk expansion. |
| `files.ts` | `/files` list / detail / status / reveal / path / open-in-editor. |
| `outline.ts` | `/outline/:fileId` + `/symbol-definition` (go-to-definition). |
| `image.ts` | `/image/:fileId/metadata` typed; per-side binary uses an `imageUrl()` URL builder (not a fetch). |
| `project-settings.ts` | `.glassbox/settings.json` get/update. |
| `reviews.ts` | Review CRUD, complete/reopen/refresh, delete-completed/all, gitignore add/dismiss. |
| `share-prompt.ts` | Share-prompt state / dismiss / tick. |
| `system.ts` | `/open-external` — open an http(s) URL in the OS default browser (used by the client under Tauri, where `target="_blank"` can't). |
| `ai.ts` | Config / models / key-status / key / analysis (start/get/status) / preferences / debug. |
| `themes.ts` | Themes list / active / create / edit / update / delete. |
| `channel.ts` | Channel status / enable / disable / trigger / claude-check. |
| `difftool.ts` | `git difftool` registration status / register / unregister. Backs both `glassbox --register-difftool` and the **Settings → General** button. |

How the layer is used:
- **Client** imports the typed callers — `await createAnnotation({...})` instead of `api<{...inline shape...}>('/annotations', {method: 'POST', body: {...}})`. No call site knows raw URLs anymore. The flat namespace `apis.createAnnotation(...)` is also available.
- **Server** route handlers `import type { CreateAnnotationReq, CreateAnnotationResp } from '../../api/index.js'` and use them in `c.req.json<XReq>()` / `c.json<XResp>(...)`. Drift between client and server fails to compile.
- Caller names are globally unique across modules (e.g. `getCurrentReview`, `getAIConfig`, `getOutline`) because they're aggregated into one flat namespace.

### `src/routes/` — HTTP handlers

| File | Purpose |
|------|---------|
| `pages.tsx` | Server-rendered HTML routes (`/`, `/file/:fileId`, `/review/:reviewId`, `/history`). Returns `SafeHtml` via JSX. |
| `api.ts` | Aggregator that mounts the per-concern sub-routers under `/api/*`. |
| `api/reviews.ts` | Review CRUD + completion / reopen / refresh / delete-completed / delete-all + gitignore prompt. |
| `api/files.ts` | Files list, file detail, file status, file reveal in OS file manager, file path (relative+absolute), open-in-default-editor. |
| `api/annotations.ts` | Annotation CRUD, move, keep, stale-handling endpoints. |
| `api/outline.ts` | `/outline/:fileId` and `/symbol-definition` go-to-definition repo scan. |
| `api/context.ts` | `/context/:fileId` line-range fetch for hunk expansion. |
| `api/project-settings.ts` | `.glassbox/settings.json` read/write (per-repo `appName`). |
| `api/image.ts` | Image diff: `/image/:fileId/metadata` and `/image/:fileId/:side` with SVG rasterization. For a difftool review (doc 19) the bytes come from the persisted blob store (`src/difftool/blob-store.ts`) instead of git refs / disk — a difftool session has neither (GB-863). |
| `api/share-prompt.ts` | Share prompt state / dismiss / tick (uses `global-config.ts`). |
| `api/system.ts` | `POST /open-external` — opens a validated http(s) URL via `openOS` (same OS-open path as file reveal). |
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
| `connection.ts` | PGLite init, schema apply, corrupt-DB recovery, `addColumnIfMissing` migrations. Exported `setDataDir`, `getDb`. Pins `database: 'template1'` in the `PGlite` constructor so on-disk data dirs created under PGLite ≤0.3.x (whose default working DB was `template1`) keep opening after the 0.4.x upgrade (whose default is `postgres`). |
| `schema.ts` | `SCHEMA_CORE_SQL` (reviews, review_files, annotations) and `SCHEMA_AI_SQL` (ai_analyses, ai_file_scores, user_preferences). Single source of truth. |
| `queries.ts` | CRUD for reviews, review_files, annotations. |
| `ai-queries.ts` | CRUD for ai_analyses, ai_file_scores, user_preferences. |

See §6 for the schema itself.

### `src/git/` — git integration

| File | Purpose |
|------|---------|
| `diff.ts` | `getFileDiffs(mode, cwd)`, `parseDiff()`, mode → `git` argv builder. Also lists untracked files for uncommitted mode, walks all files for `--all`, and runs `git diff --no-index` for the `--diff <A> <B>` direct-comparison mode (doc 18) — `directComparisonRoots(mode)` resolves the per-side display roots and `getModeFileContent(mode, file, 'old'\|'new', cwd)` reads file content for context expansion, branching to disk reads (rootA/rootB) for `--diff` and to git refs for every other mode. `diffRawContent(displayPath, oldBuf, newBuf)` produces a `FileDiff` from two raw buffers (no git refs / no caller-managed paths) by running `git diff --no-index` against a throwaway temp pair — used by the doc-19 difftool append endpoint. |
| `repo.ts` | `getRepoRoot`, `getRepoName`, `getHeadCommit`, `isGitRepo`. Also exports `scrubbedGitEnv()` — the env every internal git subprocess runs with, with `git difftool`'s leaked `GIT_EXTERNAL_DIFF` / `GIT_DIFF_PATH_COUNTER` / `GIT_DIFF_PATH_TOTAL` stripped (used by `repo.ts`, `diff.ts`, and `image.ts`'s `git show`). Left in place those would make Glassbox's own `git diff`/`git show` re-invoke the difftool helper → recursion + empty diff ("No changes found"). See doc 19 NFR-19.12. |
| `types.ts` | `ReviewMode`, `FileDiff`, `DiffHunk`, `DiffLine`. |
| `image.ts` | Image side retrieval from git (old/new), binary detection, format identification. |
| `image-metadata.ts` | Parse image headers (PNG IHDR, JPEG SOF/JFIF, GIF, WebP VP8/VP8L/VP8X) — no native deps. |
| `svg-rasterize.ts` | Public rasterization facade for SVG "Rendered" mode. `rasterizeSvg()` offloads the blocking WASM render to a long-lived worker thread (keeps the HTTP event loop responsive); re-exports `parseSvgDimensions` / `svgUsesExternalFonts`. A render exceeding a 15s timeout terminates the worker (can't interrupt sync WASM otherwise), fails that render, and re-queues jobs behind it on a fresh worker. Falls back to in-process rendering if a worker can't start. |
| `svg-rasterize-render.ts` | Shared synchronous render core (`@resvg/resvg-wasm`, font loading, 10x→4000px scale math (GB-838)). Used by both the worker and the in-process fallback. |
| `svg-rasterize-worker.ts` | Worker-thread entry: initializes WASM, renders SVG→PNG off the main thread. Emitted by tsup as `dist/svg-rasterize-worker.js` and copied next to `cli.js` in the sidecar. `svg-rasterize-worker-boot.mjs` is a dev-only shim that registers the tsx loader so the worker can load TS source. |
| `parseDiffData.ts` | Pure helper to parse `review_files.diff_data` JSON into `FileDiff` (or `null` for missing/corrupt). Safe to import from both server and client bundles. |
| `difftool-launch.ts` | Pure, unit-tested decision logic for the `glassbox-difftool` wrapper: `planSnapshot()` (dir-diff vs per-file dereference layout, preserving the filename in per-file mode) and `resolveLaunchTarget(selfDir, exists, platform)` (platform-aware desktop-bundle launcher-shim detection — `glassbox` on macOS, `glassbox-linux` on Linux, `glassbox.cmd` on Windows; browser fallback otherwise). Exports `DIFFTOOL_BLOCK_ENV` (the `GLASSBOX_DIFFTOOL_BLOCK` contract honored by the macOS + Windows launcher shims; on Linux the shim `exec`s Tauri so blocking is inherent). The launcher opens the Tauri window and the app forwards `--diff` to its self-spawned sidecar (`src-tauri/src/lib.rs`). Windows `.cmd` shims are spawned via a shell with quoted args. Note: `git diff --no-index` needs forward-slash paths on Windows or it emits an unparseable quoted header — see `toGitArg` in `git/diff.ts`. Also exports the doc-19 pure decisions `parseGitDiffCounter(env)` / `shouldHoldForSession(env)` (last-file detection from `GIT_DIFF_PATH_COUNTER`/`TOTAL`, with a counter-unavailable fallback). |
| `difftool-discovery.ts` | doc 19 — rendezvous between the wrapper and the detached accumulating server via `~/.glassbox/difftool.lock` (records the server port) and `difftool-starting.lock` (a stale-aware start election so a multi-file burst doesn't race into N servers). `parseDiscovery()` is a pure, unit-tested parse. |
| `difftool-client.ts` | doc 19 thin-client IO for the per-file path: `discoverOrStartServer(start, timeoutMs?)` (find a running session or win the election and run `start`, probe-with-retry), `appendFile()` (POST raw base64 content; throws on failure so no file is silently dropped), `holdUntilEnd()` (hold the last-file connection until the session ends). The injected `start` is `spawnDetachedBrowserServer()` (browser — `cli.js --difftool-serve`, opens a tab) or `launchDetachedDesktopSession()` (desktop — launches the launcher shim in `--difftool-serve` mode so the review opens in one Tauri window, GB-861). All over `127.0.0.1`. |
| `difftool.ts` | `git difftool` registration helpers — `getDifftoolStatus(scope)`, `registerDifftool({scope, force})`, `unregisterDifftool({scope})`. Pure wrappers over `git config`. `registerDifftool` refuses to overwrite a non-Glassbox `diff.tool` unless `force: true`. `unregisterDifftool` only touches keys we set (won't delete a third-party tool just because the cmd happens to match). Called from `cli.ts` (`--register-difftool` / `--unregister-difftool` flags) and from `routes/difftool-api.ts` (settings dialog). |

### `src/ai/` — AI analysis subsystem

| File | Purpose |
|------|---------|
| `models.ts` | Static platform/model list — now the **fallback** for live discovery (`list-models.ts`); also defaults + context windows + ENV var names. `resolveModelId(platform, id)` best-effort-maps a stale/older id to the current same-tier model (GB-893). |
| `list-models.ts` | **Live model discovery** (GB-894): `fetchAvailableModels(platform, key)` hits each provider's models API (Anthropic `/v1/models`, OpenAI `/v1/models` filtered to chat, Google `/v1beta/models` filtered to `generateContent`), zod-validates, maps to `{id,name,contextWindow}`; returns `null` on failure so the caller falls back to the static list. |
| `config.ts` | Load/save `~/.glassbox/config.json` (platform, model, guided settings, share prompt, channel enabled, cumulative open time). |
| `api-keys.ts` | Key resolution chain: env var → OS keychain → base64 in config file. Save/delete, source detection. |
| `keychain.ts` | OS keychain wrappers: macOS `security`, Linux `secret-tool`, Windows `cmdkey`. |
| `client.ts` | Unified HTTP client. `sendAIRequest(config, system, messages)` dispatches to Anthropic / OpenAI / Google / **Local** (OpenAI-compatible — `sendLocalRequest` posts to `{config.baseUrl}/chat/completions`, optional Bearer; keyless platforms skip the no-key gate via `KEYLESS_PLATFORMS`). Returns content + token counts. |
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
| `charDiff.ts` | Character-level diff highlighting for intra-line changed words. Bails (no inline highlight) on lines past `MAX_LINE_LENGTH` to avoid an O(m*n) LCS table. |
| `lineTruncate.ts` | `truncateDiffLine()` + `MAX_DIFF_LINE_LENGTH`. A diff line longer than the threshold (minified bundle / base64 / single-line SVG) is rendered as a bounded prefix plus a `.line-truncated` marker by `DiffView`, so the DOM never holds a multi-hundred-KB text node whose layout/paint freezes the UI (GB-821). Full content stays in the stored diff. |
| `escapeHtml.ts` | HTML entity escaping used by the JSX runtime. |
| `formatReviewMode.ts` | `formatReviewMode(mode, modeArgs)` — single source of truth for the sidebar / history "review mode" label. Strips the redundant `mode + ": " + mode_args` duplication and shortens 40-char SHAs in `commit:` / `range:` modes to 7 chars. |
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
| `diff/` | `index.tsx`, `selection.ts`, `toolbar.tsx`, `highlight.ts`, `highlightLimits.ts`, `hunkExpander.tsx`, `splitSync.ts`, `navStack.ts`, `find.tsx`, `goToDefinition.tsx`, `outline.tsx`, `aiNotes.tsx`, `imageDiff/` (`index.ts`, `zoom.ts`, `sliceTool.ts`, `sliceGeometry.ts`, `metadata.ts`) | Diff pane orchestration. `imageDiff/sliceGeometry.ts` is the DOM-free slice math (edge detection, `snapToEdge`, `edgeHandleTransform` keeping handles inside the canvas, clip-path perimeter helpers) extracted so it can be unit-tested; `sliceTool.ts` is the imperative wiring. The image canvas fills its slot via a `:has(.image-diff)` flex chain (`#diff-container` is set to `display:flex` in `runPostRender`) so the slice handles pinned to the bottom edge aren't hidden under the toolbar (GB-823). `highlight.ts` runs highlight.js per `.code` cell but skips any line longer than `MAX_HIGHLIGHT_LINE_LENGTH` (in the dependency-free `highlightLimits.ts`) and any cell carrying a `.line-truncated` marker. The primary GB-821 guard, though, is server-side **truncation**: `DiffView` (`components/diffView.tsx`, via `utils/lineTruncate.ts`) renders only a bounded prefix of a pathologically long line, so the giant content never reaches the DOM. Skipping highlighting alone was insufficient — the plain giant text node still froze the browser laying it out and painting it (worst in the desktop WKWebView; headless browsers skip the real paint, so the freeze didn't reproduce in headless timing tests). `index.tsx` is the entry: kerf `mount()` onto `#diff-container` renders a single `data-morph-skip` wrapper around the server-rendered diff HTML, with a generation-counter `data-key` that bumps on every fetch so file/mode/whitespace switches replace the subtree. An async effect refetches `/file/:id` when relevant state changes; a post-render effect runs highlight + outline + AI notes + annotation binding. `delegate()` handles diff-line clicks → annotation form, hunk-separator expansion, drag-and-drop, and split-column scroll sync (the latter via `addEventListener` in capture phase because of the `target.scrollLeft` semantics). `toolbar.tsx` delegates split/unified, wrap, whitespace, image mode, svg mode, and language picker; a small `effect()` mirrors store state back onto the persistent toolbar buttons. Image diff (zoom/pan/slice) stays imperative inside the morph-skipped subtree. |
| `sidebar/` | `index.tsx`, `fileListView.tsx`, `sortControl.tsx`, `sortMode.tsx`, `riskPopover.tsx`, `contextMenu.tsx`, `contextMenuLabels.ts`, `fileTree.tsx` | `initSidebar()` mounts two reactive trees (sort control + file list) via kerf `mount()` and wires every interaction through `delegate(sidebar, …)` — no per-element `addEventListener` left in this dir. `fileListView.tsx` renders folder/risk/narrative JSX (keyed with `data-key`), `sortControl.tsx` renders the segmented control + risk dimension select, `sortMode.tsx` owns analysis polling (`switchSortMode`, `triggerAnalysis`, `invalidateAnalysisCache`, `loadAnalysisResults`), `riskPopover.tsx` renders the per-file risk dimension breakdown, `contextMenu.tsx` is the right-click file menu (doc 21; `bindFileContextMenu` — reveal / copy path (Alt-toggles relative↔absolute) / mark reviewed-pending / open in editor) with pure label helpers split into `contextMenuLabels.ts`, `fileTree.tsx` is the `loadFiles()` API call. Auto-scroll-to-selected runs as a `kerfjs` `effect()` watching `currentFileId`. |
| `annotations/` | `events.tsx`, `form.tsx`, `render.tsx`, `reclassifyPopup.tsx`, `categories.tsx` | `bindAnnotationEvents(diffContainer)` + `bindCreateFormEvents(diffContainer)` register `delegate()` handlers for every annotation interaction (delete / edit / dblclick-to-edit / reclassify / keep / dragstart / textarea input / Ctrl+Enter save / Escape cancel). Server-rendered annotation rows carry `data-key={id}`; mid-edit form state lives in `editFormSignal` and picker open state in `categoryPickerSignal` (both in `stores/index.ts`) so a sibling update doesn't clobber an open form. The popup itself is a transient `document.body` overlay with a single `document.addEventListener` for outside-click dismiss (popups outside any `mount()` tree use direct listeners; inside a mount tree we'd use `delegate()` to survive re-renders). |
| `review/` | `modal.tsx`, `progress.tsx` | Completion modal (with optional "Send to Claude" when channel is on), gitignore prompt, progress bar. |
| `settings/` | `dialog.tsx`, `tabContext.ts`, `generalTab.tsx`, `profileTab.tsx`, `experimentalTab.tsx`, `updatesTab.tsx`, `themeEditor.tsx`, `themeManager.tsx` | Tabbed settings modal. Each tab is a `Tab` registry entry (`{ id, label, icon, enabled?, render, bind }`) sharing a single `TabContext` defined in `tabContext.ts`. Dialog iterates the registry — adding a new tab is a one-line change. Auto-save on change; no Save/Cancel. AI config lives under Experimental. |
| `styles/` | `_variables.scss`, `_base.scss`, `_sidebar.scss`, `_diff.scss`, `_annotations.scss`, `_buttons.scss`, `_modal.scss`, `_scrollbar.scss`, `_highlight.scss`, `_history.scss`, `_ai-sort.scss`, `_image-diff.scss`, `_settings.scss`, `_update-banner.scss` | SCSS partials imported by `styles.scss`. |

### `src-tauri/src/` — Rust desktop shell

| File | Purpose |
|------|---------|
| `main.rs` | Entry; calls `glassbox_lib::run()`. |
| `lib.rs` | Everything: setup, sidecar spawn + PID tracking + exit cleanup, CLI install/check commands (macOS symlink / Linux symlink / Windows .cmd + PATH), updater commands, native Find menu wiring. Has a `#[cfg(test)] mod tests` covering the pure `manual_install_command` (the only Rust unit test today — `cargo test` runs it in CI's `rust` job). See `docs/tauri-architecture.md` for the full picture. |

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

Files: `GET /files`, `GET /files/:fileId`, `PATCH /files/:fileId/status`, `POST /files/:fileId/reveal`, `GET /files/:fileId/path`, `POST /files/:fileId/open`.

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

### `/api/difftool/*` (`routes/difftool-api.ts`)

**Registration:** `GET /status`, `POST /register`, `POST /unregister`. Always
operates at `--global` scope (the settings dialog is the "what affects every
repo I use" surface; `--local` stays CLI-only). Backed by helpers in
`src/git/difftool.ts`.

**Accumulating session (doc 19, browser):** `GET /ping` (wrapper readiness
probe), `POST /append` (append one file from raw base64 `{path, oldContentB64,
newContentB64}` → diffed via `diffRawContent()` in `git/diff.ts`, de-duped by
path), `GET /poll` (live file list + `active` flag for the client sidebar),
`GET /hold` (the last-file wrapper holds this open so `git difftool` stays
attached; resolves on session end), `POST /end` ("Done" / tab-close
`sendBeacon`). Session state + lifecycle live in `src/difftool/session.ts`;
the detached server is started by `glassbox --difftool-serve`. On append, an
image/SVG file's raw old/new bytes are persisted by `src/difftool/blob-store.ts`
(content under `<dataDir>/difftool-blobs/`, keyed by `fileId`+side, cleared on
session start + teardown) so the `/image` route can serve them — a difftool
review has no git refs / working tree to re-read (GB-863).

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

Provided by **kerfjs** (`kerfjs/jsx-runtime`). Configured via:

- `tsconfig.json`: `"jsx": "react-jsx"`, `"jsxImportSource": "kerfjs"`
- `tsup.config.ts`: esbuild sets `options.jsxImportSource = 'kerfjs'` for
  both server and client builds

Rules:

- Components return `SafeHtml` (aliased as `JSX.Element`). Import the type
  from `'kerfjs'`.
- String children are auto-escaped.
- Use `raw(html)` from `'kerfjs'` to inject pre-escaped HTML (e.g.,
  highlighted code).
- In client code, cross into DOM only at the last moment via
  `toElement(<…/>)` from `src/client/dom.ts` (a thin wrapper over kerfjs's
  `toElement`). Never use `document.createElement`.
- For in-place reconciliation of an existing DOM subtree against a new
  template, use `morph(liveRoot, template)` from `'kerfjs'`. For driving
  a subtree from a signal, use `mount(rootEl, () => renderJsx())`.

## 7.1 Client reactivity model

- **State** lives in `defineStore` instances in `src/client/stores/index.ts`
  (`reviewStore`, `diffViewStore`, `aiStore`, `dragStore`) plus per-feature
  `signal()` instances (`editFormSignal`, `categoryPickerSignal`).
  Computed: `filteredFiles`, `visibleFileOrder`, `aiEnabled`.
- **Re-renders** happen via `mount(rootEl, () => renderJsx())` — re-runs on
  signal changes and morphs the live tree against the new template.
  No manual `renderX()` callsites; the previous `el.innerHTML = jsx.toString()`
  pattern is forbidden inside a mount tree.
- **Events** use `delegate(rootEl, 'click', selector, handler)` (or
  `delegateCapture` for non-bubbling / capture-phase). Per-element
  `addEventListener` inside a mount tree silently disappears on re-render.
  Document-level listeners for drag lifecycle / popup-dismiss / global
  keyboard shortcuts are fine.
- **List items** carry `data-key={id}` for keyed morph identity.
- **Escape hatches**: `data-morph-skip` (kerf doesn't touch the subtree),
  `data-morph-skip-children` (attrs morph, subtree skipped),
  `data-morph-preserve` (imperatively-injected child survives trailing-removal).

## 7.2 Lint enforcement (`eslint-plugin-kerfjs`)

`eslint.config.mjs` extends `kerfjs.configs.recommended`, which turns on
four AST-level error rules that catch kerf antipatterns at edit time:

- `kerfjs/no-inline-jsx-event-handlers` — disallow `onClick`-style attrs;
  use `data-action` + `delegate()`.
- `kerfjs/require-data-key-in-each` — `each()` row roots must carry
  `data-key` (or `id`).
- `kerfjs/no-nested-mount` — one `mount()` per root.
- `kerfjs/prefer-module-jsx-augmentation` — augment `kerfjs/jsx-runtime`
  rather than the global `JSX` namespace.

These complement the reactivity rules in §7.1; running `npm run lint`
covers the antipatterns that don't need flow / type info.

## 8. Client bundle

Two IIFE bundles from `src/client/`:

- `dist/client/app.global.js` — main app (from `app.tsx`)
- `dist/client/history.global.js` — history page (from `history.tsx`)

`app.tsx` wires up, in order: debug probe → AI sort state (loads prefs,
checks config) → load files → init sidebar (mounts sort control + file list
reactively) → init diff view (mounts the diff pane with an async fetch
effect) → toolbar / find / go-to-definition / completion / progress
(reactive) → drag-end / nav buttons / scroll tracking.

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
| diff `<A> <B>` | `git diff --no-index <A> <B>` (doc 18 — works outside a repo) |

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
- `demo:capture-stills` — regenerate the static README screenshots (`assets/demo-{guided-review,risk-mode,narrative-mode,annotations,settings,direct-comparison}.{png,svg}`). Boots each `--demo:N` scenario in turn, runs a minimal scenario-specific UI setup (open the showcased file, flip a sort mode, open the settings dialog, …), and captures both a Playwright PNG and a `domotion-svg` stand-alone SVG per scenario. Lives in `scripts/demo/capture-stills.ts`. Must run outside the command sandbox (Chromium).
- `demo:capture` — regenerate the animated README hero `assets/demo.svg` (+
  `.svgz`). Boots a real `--demo:1` server, drives the risk-triage → annotate →
  complete → `/glassbox` loop with Playwright, captures each beat via
  `domotion-svg`, and composites one looping SVG framed in browser/terminal
  window chrome with captions + an animated cursor. Lives in `scripts/demo/`
  (`capture-demo.ts` orchestrator, `scenes.ts` terminal/markdown/end-card,
  `chrome.ts` window-chrome compositing); see `scripts/demo/README.md`.
  `domotion-svg` is pinned to 0.13.3 and forced to embedded-font text mode
  (`setRenderTextMode`). Must run outside the command sandbox (Chromium).
- `release` — version bump + publish stable (see `scripts/release.sh`)
- `release:beta` — opt-in pre-release; tag-only flow, no version-file bump or CHANGELOG edit (`scripts/release.sh --beta`). CI publishes npm `--tag beta` + GH prerelease.

`tsup.config.ts` produces:

- `dist/cli.js` — ESM, Node 20 banner (`#!/usr/bin/env node`). External:
  `@electric-sql/pglite`, `hono`, `@hono/node-server`, `@resvg/resvg-wasm`,
  `@modelcontextprotocol/sdk`.
- `dist/channel.js` — channel server entry (also ESM, similar externals).
- `dist/svg-rasterize-worker.js` — SVG rasterization worker thread, spawned by
  `cli.js` as a sibling (`new URL('./svg-rasterize-worker.js', import.meta.url)`).
  `build-sidecar.sh` copies it next to `cli.js`; omitting it makes rasterization
  fall back to blocking in-process rendering.
- `dist/client/app.global.js` — IIFE, es2020, minified.
- `dist/client/history.global.js` — IIFE for the history page.
- `dist/client/styles.css` — compiled + compressed from SCSS.

JSX runtime is `kerfjs/jsx-runtime` (shared by server + client builds via
`tsconfig.json` and `tsup.config.ts`'s `jsxImportSource: 'kerfjs'`).

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

The E2E web server runs `--demo:4 --ai-service-test` (see
`playwright.config.ts`). `--ai-service-test` makes AI analysis use mock
responses and bypass the API-key check, so the suite is **hermetic** — it
never makes real AI calls and doesn't depend on a real key existing on the
machine. Without it, any test that triggers a live risk/narrative analysis
only passes where a key happens to be configured (env / keychain / config),
and 400s in CI.

To reproduce CI's Linux e2e environment locally, `scripts/test-e2e-docker.sh`
(`npm run test:e2e:docker`) runs the suite inside the
`mcr.microsoft.com/playwright:vX.Y.Z-noble` image (version pinned from
`package.json`). Because the container has no macOS keychain / API key, it
catches environment-dependent failures a local macOS pass would miss. It
shadows `node_modules` with an anonymous volume so the container's
Linux-native binaries don't overwrite the host's.

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
on every launch (via `releases/latest/...`, which skips prereleases).
Opt-in install only. Public key embedded in `tauri.conf.json`.

Dependency security: `release-candidate.yml`'s validation phase includes an
`audit` gate (`npm audit --omit=dev --audit-level=high`) that hard-fails the
release on a high/critical advisory in a *shipped* dependency; it gates every
downstream publish job. `.github/dependabot.yml` (weekly npm, dev-deps grouped
into one PR) keeps the tree fresh between releases so the gate rarely has
anything to block on.

The same validation phase also has a `rust` gate (Tauri shell, `src-tauri/`):
`cargo fmt --check` + `cargo clippy --all-targets -- -D warnings` + `cargo test`,
on Linux with the webkit2gtk dev headers (the `glassbox` crate links tauri/webkit
even for `clippy`). It gates every downstream publish job alongside `audit`. This
is the *only* Rust test/lint gate — the other workflows that install Rust merely
`tauri build` (compile) the app; `difftool-smoke.yml` additionally runs the built
`glassbox-difftool` binary end-to-end.

CI workflows:
- `release-candidate.yml` — `v*-rc.*` tags → validate → npm@beta → smoke →
  promote to npm@latest → dispatch `release-desktop.yml`.
- `release-beta.yml` — `v*-beta.*` tags → validate → npm@beta → prerelease
  GH Release with Tauri bundles. No auto-promote; users opt in via
  `npm install glassbox@beta` or the GH Release page.
- `release-desktop.yml` — `v[0-9]*` tags excluding `-rc.*` and `-beta.*` →
  signed/notarized stable desktop bundles. Its `create-release` step builds the
  release body's per-platform **Download** summary, and a `rename-assets` job
  renames the macOS `.dmg`s to friendly names — both driven by
  `scripts/release/release-assets.mjs` (single source of truth, so a download
  link never 404s against a mismatched asset name). `publish-release` flips the
  draft → published only after `rename-assets`, guarded by
  `tests/unit/scripts/release-assets.test.ts`.

## 17. Maintenance rules

Update `docs/ai/code-summary.md` in the same pass whenever you:

1. Add, remove, or rename a file under `src/` or `src-tauri/src/`.
2. Add, remove, or restructure a subfolder under `src/client/`,
   `src/routes/`, `src/api/`, `src/ai/`, `src/git/`, `src/db/`, `src/themes/`,
   `src/export/`, `src/outline/`, `src/utils/`, or `src/components/`.
3. Add or remove an HTTP route (page, API, AI, theme, channel). This
   ALWAYS pairs with adding a typed Req/Resp + caller in `src/api/<resource>.ts`.
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
| Add a new API endpoint | **Two-sided change.** 1) Define `XReq`/`XResp` types + a typed caller (`createX`, `getX`, …) in the matching `src/api/<resource>.ts`. 2) Pick the right sub-router under `src/routes/api/` (or `routes/ai-*.ts`, `theme-api.ts`, `channel-api.ts`) and use `c.req.json<XReq>()` / `c.json<XResp>(...)`. Caller names must be globally unique across modules (flat `apis` namespace). Client call sites use `await getX({ ... })` from `../api/index.js` — never the raw `api<T>()` helper. |
| Add a new page/route | `src/routes/pages.tsx`; register in `src/server.ts`. |
| Change the DB schema | `src/db/schema.ts` (tables/indexes) + a migration in `src/db/connection.ts` (`addColumnIfMissing` pattern). Query code in `src/db/queries.ts` or `ai-queries.ts`. |
| Add an annotation category | `src/client/state.ts` (CATEGORIES), `src/client/annotations/categories.tsx` (UI), `src/routes/api/annotations.ts` (`VALID_CATEGORIES`), `src/export/generate.ts` (export semantics). Update `docs/5-annotations.md` + `docs/6-export.md`. |
| Add a CLI option | `src/cli.ts` `parseArgs()` switch; document in `docs/2-cli-and-server.md`. |
| Add an AI platform | `src/ai/models.ts` (platform enum + fallback models + env key; `KEYLESS_PLATFORMS` if no key needed), `src/ai/list-models.ts` (live-discovery fetch+map), `src/ai/client.ts` (HTTP/spawn dispatch), `src/ai/config.ts` (any per-platform config like a base URL), `src/ai/api-keys.ts` (key source mapping), `src/routes/ai-config.ts` + `src/api/ai.ts` (config/discovery/key-status wiring), `src/client/settings/experimentalTab.tsx` + `dialog.tsx` (picker + any platform-specific inputs). The `local` platform (doc 22) is the worked example of a keyless, base-URL-configured provider. Update `docs/7-ai-analysis.md`. |
| Update / discover AI models | Models are discovered live per provider in `src/ai/list-models.ts` (used by `GET /api/ai/models`); `src/ai/models.ts` holds the static fallback + `resolveModelId` old→new mapping. |
| Add a theme | `src/themes/built-in.ts` (built-in), or create `~/.glassbox/themes/*.json` (custom). All vars from `ThemeColors` must be present. |
| Change export format | `src/export/generate.ts`. Update `docs/6-export.md`. |
| Add a diff mode/view | `src/client/diff/` (new module), wire into `src/client/diff/index.tsx` (mount + delegates) and `toolbar.tsx`. Server rendering lives in `src/components/diffView.tsx`. |
| Add a new image diff mode | `src/components/imageDiff.tsx` + `src/client/diff/imageDiff/` (`index.ts` orchestration, `zoom.ts`, `sliceTool.ts`, `metadata.ts`). |
| Tweak go-to-definition | `src/outline/parser.ts` (regex rules) and `src/client/diff/goToDefinition.tsx` (wiring). |
| Add a SCSS partial | Create `src/client/styles/_thing.scss`, `@use` it from `src/client/styles.scss`. |
| Add client state | `src/client/stores/index.ts` — pick the matching store (`reviewStore` / `diffViewStore` / `aiStore` / `dragStore`) or add a new one. Types in `state.ts`. |
| Add a Tauri command | `src-tauri/src/lib.rs` (`#[tauri::command]` + `invoke_handler`). Call from `src/client/tauri.ts`. **Also** register it in `src-tauri/build.rs` (`AppManifest::new().commands([...])`) and grant the generated `allow-<cmd>` (kebab-case) in `src-tauri/capabilities/remote-localhost.json` — the frontend is served over `http://localhost:*`, a "remote" origin, and Tauri 2.11 rejects ungranted app commands there with `<cmd> not allowed. Plugin not found`. |
| Change the sidecar build | `scripts/build-sidecar.sh` + `tsup.config.ts` + CLAUDE.md external-deps list. |
| Add an MCP-channel capability | `src/channel.ts` (MCP handler), `src/channel-config.ts` (if `.mcp.json` shape changes), `src/routes/channel-api.ts` (UI-facing endpoint). Update `docs/17-claude-channel.md`. |

## Related reading

- `CLAUDE.md` — project rules, build/test commands, and coding conventions.
- `docs/ai/requirements-summary.md` — synthesized view of every
  requirements doc.
- `docs/ARCHITECTURE.md` — higher-level architecture narrative.
- `docs/tauri-architecture.md` — Tauri sidecar deep dive.
- `docs/tauri-setup.md` — certificates, signing keys, GitHub secrets.
- `docs/1-review-workflow.md` … `docs/19-difftool-integration.md` — numbered
  functional / non-functional requirements.
