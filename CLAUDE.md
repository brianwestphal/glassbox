# Glassbox

## Project Overview

A locally-running web application for reviewing AI-generated code. Launched from the CLI inside any git repository, it opens a browser-based diff viewer where users annotate lines with categorized feedback. On completion, annotations are exported as structured markdown that AI tools (Claude Code, Cursor, etc.) can read and act on.

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript (strict mode)
- **Server**: Hono framework with `@hono/node-server`
- **Desktop**: Tauri v2 (Rust) — wraps the Node.js server in a native window
- **Database**: PGLite (embedded PostgreSQL) — data stored in `~/.glassbox/data/`
- **Rendering**: kerfjs JSX runtime (no React) — produces HTML strings server-side via `SafeHtml`; client-side reactivity via `mount()` / `delegate()` / `signal()` / `defineStore`
- **Build**: tsup (server CLI + client JS bundles) + sass (SCSS → CSS)
- **Dev**: tsx for direct TypeScript execution (client assets pre-built)

## Architecture

The app is a single-entry CLI (`src/cli.ts`) that:

1. Parses CLI args to determine review mode (uncommitted, staged, commit, branch, etc.)
2. Runs git commands to collect file diffs
3. Creates a review record in PGLite
4. Starts a Hono HTTP server on port 4183

### Documentation

All project documentation lives in `docs/`. There are three types:

**AI-oriented summaries** (`docs/ai/`) are the fastest way for a fresh AI session to orient. Read these at the start of a session before diving into individual docs or source files:

- `docs/ai/code-summary.md` — codebase map: directory tree, routes catalog, schema, client modules, build pipeline, and a "Where do I look to…" reverse index. Also human-readable for sanity checking.
- `docs/ai/requirements-summary.md` — synthesized view of every requirements doc, organized by theme with status markers.

Both summaries are actively maintained. Update them in the same pass whenever you make a relevant change (see triggers listed in each file's final section). If you add, rename, or renumber a requirements doc, also update the index below.

**Requirements documents** (`docs/N-topic.md`) define what the application does. They are numbered for linear reading order and contain functional (FR-) and non-functional (NFR-) requirements:

- `1-review-workflow.md` — Review creation, resumption, completion, history
- `2-cli-and-server.md` — CLI options, HTTP server, API endpoints, browser launch
- `3-git-integration.md` — Repository detection, diff generation, review modes
- `4-diff-viewing.md` — Split/unified modes, syntax highlighting, context expansion, image comparison
- `5-annotations.md` — Categories, CRUD, drag-and-drop, stale handling
- `6-export.md` — Markdown export format and AI tool instructions
- `7-ai-analysis.md` — Risk scoring, narrative ordering, guided review, API keys
- `8-user-interface.md` — Layout, navigation, settings dialog, keyboard shortcuts
- `9-data-storage.md` — PGLite schema, config files, data locality
- `10-desktop-app.md` — Tauri sidecar, launch flows, CLI install, updates
- `11-build-and-distribution.md` — Build pipeline, npm/desktop packaging, CI/CD
- `12-demo-mode.md` — Demo scenarios and isolation
- `13-navigation.md` — Go-to-definition, navigation stack (back/forward)
- `14-security.md` — Network binding, input validation, command execution safety
- `15-themes.md` — Theme system, built-in themes, custom themes, theme editor
- `16-share-prompt.md` — Share prompt trigger, share button, Web Share API
- `17-claude-channel.md` — Claude Code MCP channel integration, channel server, completion modal
- `18-direct-comparison.md` — Diffing two arbitrary files or folders by path (`--diff`), independent of git history
- `19-difftool-integration.md` — Using Glassbox as a registered `git difftool`; the `glassbox-difftool` companion binary, `--dir-diff` vs per-file modes, and the accumulating single-session model for per-file mode
- `20-ai-review-notes.md` — AI-authored, line-anchored review notes (rationale/proof) emitted by the generating AI, stored as committed SARIF in `.pr-notes/`, rendered review-comment-style in the diff (P1 shipped: the `.pr-notes/` SARIF format + the `glassbox note` producer CLI; reader/render and later phases pending)
- `21-sidebar-context-menu.md` — Right-click context menu on sidebar file rows; the cross-platform "reveal in file manager" action
- `22-local-and-on-device-models.md` — Local OpenAI-compatible (Ollama/LM Studio) and Apple Foundation Models (on-device) as AI platforms (P1 local platform shipped; Apple FM P2 design only)

**Architecture documents** describe system design and setup:

- `ARCHITECTURE.md` — Overall software architecture (components, data flow, build pipeline)
- `tauri-architecture.md` — Tauri desktop integration (sidecar, launch flows, CLI wrappers)
- `tauri-setup.md` — Tauri setup guide (certificates, signing keys, GitHub secrets)

**When making changes, keep docs in sync:**

- If a change affects existing requirements, update the relevant requirements document.
- If a change introduces a new major area not covered by existing documents, create a new numbered requirements document. Insert it at the appropriate position in the reading order and renumber subsequent documents.
- If a change affects architecture or system design, update the relevant architecture document.
- For complex new subsystems, create a dedicated architecture document rather than overloading existing ones.

### Key Directories

- `src/cli.ts` — CLI entry point, arg parsing. Also dispatches the `glassbox note` subcommand (producer-side review-note writer) before normal arg parsing.
- `src/review-notes/` — AI-authored review notes (doc 20): the `.pr-notes/` SARIF format (`sarif.ts`), the path-sharded on-disk store + reader (`store.ts`; `writeReviewNote` … `loadReviewNotesForFile`), the diff-anchored view shape (`view.ts`), the load-time re-anchorer (`reanchor.ts`, P3), the analysis/export folding (`format.ts`, P5 — feeds notes into `ai/shared.ts` prompts + the `export/generate.ts` markdown), the `glassbox note` CLI (`cli.ts`; `add` / `update` / `remove` / `coalesce` / `instructions`), and the inbound AI-instructions contract (`instructions.ts`). P2 render lives in `src/components/diffView.tsx` (`ReviewNoteRows`, server-rendered full-width; stale notes get an "outdated" badge; a Reply button threads a human annotation onto a note via the `annotations.reply_to_note_id` column, rendered nested beneath the note). Note bodies render as markdown via the safe escape-first `src/utils/noteMarkdown.ts` (shared with the risk/narrative/guided AI notes). Glassbox is the consumer of a tool-neutral, producer-written format.
- `src/cli-difftool.ts` — `glassbox-difftool` bin entry (git-difftool bridge). Dereferences symlinks in `git difftool --dir-diff`'s asymmetric snapshot dirs, then exec's `glassbox --diff` on the resolved tree. See README "Use as `git difftool`" for setup.
- `src/server.ts` — Hono app setup, middleware injection
- `src/api/` — **Typed API layer (shared by client + server).** Each per-resource module (`annotations.ts`, `reviews.ts`, `themes.ts`, `files.ts`, `context.ts`, `outline.ts`, `image.ts`, `project-settings.ts`, `share-prompt.ts`, `system.ts`, `ai.ts`, `channel.ts`, `review-notes.ts`) defines a zod `XReqSchema` / `XRespSchema` for each endpoint and exports the inferred TS types alongside the typed client caller functions. Client callers go through `apiCall(RespSchema, path, ...)` (see `src/api/_runner.ts`) which validates the response against the schema before returning — a bad response fails loudly at the boundary. Server route handlers parse incoming bodies with `parseBody(c, ReqSchema)` and validate non-empty path params with `requirePathParam(c, name)` (both in `src/utils/parseBody.ts`), returning a structured 400 on failure. The schema is the single source of truth; drift fails at compile time AND at runtime.
- `src/routes/api.ts` — JSON API (annotations CRUD, file status, review management). Handlers consume Req/Resp types from `src/api/`.
- `src/routes/ai-api.ts` — AI analysis, configuration, and preferences API. Handlers consume Req/Resp types from `src/api/ai.ts`.
- `src/routes/pages.tsx` — Server-rendered HTML pages
- `src/components/` — TSX components (layout, diffView, fileList, reviewHistory)
- `src/db/connection.ts` — PGLite setup and schema initialization (raw SQL, no ORM)
- `src/db/schemas.ts` — Zod schemas for every DB row shape (`Review`, `ReviewFile`, `Annotation`, `AIAnalysis`, `AIFileScore`, `UserPreferences`) plus `parseRow` / `parseRows` / `parseJsonColumn` helpers. The SSOT for runtime row validation; `queries.ts` and `ai-queries.ts` route every PGLite result through these.
- `src/db/queries.ts` — All database operations
- `src/db/ai-queries.ts` — AI analysis and preferences database operations
- `src/ai/models.ts` — Static AI model lists per platform — now the **fallback** for live discovery (see `list-models.ts`); also holds defaults, context windows, and `resolveModelId()` (best-effort old→new id mapping). Keep reasonably current as a fallback, but live discovery means it no longer needs daily updates.
- `src/ai/list-models.ts` — Live model discovery from each provider's models API (`fetchAvailableModels`), with the static list as fallback; powers `GET /api/ai/models`
- `src/ai/config.ts` — API key resolution (env → keychain → config file) and config management
- `src/ai/client.ts` — Unified HTTP client for Anthropic, OpenAI, and Google AI APIs
- `src/ai/context-builder.ts` — Builds diff context payloads for AI analysis
- `src/ai/analyze-risk.ts` — Risk analysis orchestration with multi-turn context loop
- `src/ai/analyze-narrative.ts` — Narrative ordering analysis with multi-turn context loop
- `src/git/diff.ts` — Git operations: diff generation, parsing, file listing
- `src/git/image.ts` — Image diff support: old/new image retrieval from git, metadata extraction from headers
- `src/git/svg-rasterize.ts` — SVG to PNG rasterization for rendered comparison mode. `rasterizeSvg()` offloads the synchronous `@resvg/resvg-wasm` render to a worker thread (`svg-rasterize-worker.ts`, shared render core in `svg-rasterize-render.ts`) so it never blocks the HTTP event loop; a render exceeding a 15s timeout terminates the worker and fails fast (re-queuing other jobs on a fresh worker); falls back to in-process rendering if a worker can't start. tsup emits the worker as `dist/svg-rasterize-worker.js` and `build-sidecar.sh` copies it next to `cli.js`; `svg-rasterize-worker-boot.mjs` is the dev-only tsx shim
- `src/themes/built-in.ts` — Built-in theme definitions (Dark, Light, High Contrast, Dracula, Tokyo Night), ThemeColors type
- `src/themes/config.ts` — Theme persistence: active theme in config.json, custom themes in ~/.glassbox/themes/
- `src/routes/theme-api.ts` — Theme REST API: list, get/set active, create/update/delete custom themes
- `src/client/themes.ts` — Client-side theme switching: applyThemeColors(), switchTheme()
- `src/export/generate.ts` — Generates `.glassbox/latest-review.md` on review completion
- `src/types.ts` — Shared Hono environment types
- `src-tauri/` — Tauri desktop app (Rust backend, loading screens, CLI wrappers) — see `docs/tauri-architecture.md`

### Type safety: validating, not asserting

The codebase prefers **runtime validation** over `as` assertions for any data crossing a trust boundary (the network, the file system, PGLite, a JSON column). The mechanics:

- **Wire data** flows through zod schemas in `src/api/*.ts`. Never write `body as XReq` or `json as XResp`; use `parseBody(c, XReqSchema)` on the server and `apiCall(XRespSchema, ...)` on the client.
- **DB rows** are validated by `parseRow` / `parseRows` in `src/db/schemas.ts`. Never declare `db.query<X>(...)` and trust the cast; the helpers return parsed values whose TS type is guaranteed.
- **JSON columns** (the `dimension_scores` / `notes` columns in `ai_file_scores`, plus `review_files.diff_data`) are validated by `parseJsonColumn(schema, raw)` and `FileDiffSchema` respectively.
- **JSON config files** (`~/.glassbox/config.json`, project `.glassbox/settings.json`, custom theme files in `~/.glassbox/themes/*.json`) are validated by `ConfigFileSchema` / `ProjectSettingsSchema` / `StoredCustomThemeSchema` at read time.

When `as` is genuinely the right tool — DOM casts inside `delegate(root, 'click', selector, (_e, el) => ...)` where the selector is the runtime check, or framework-bridging casts like `appFetch as never` — keep the cast tight (one line, with the runtime guarantee visible right beside it). Avoid `as` on anything that started life as `JSON.parse`, `c.req.json`, `fetch().json()`, `db.query`, or user input.

### JSX Runtime

The project uses **kerfjs** (`kerfjs/jsx-runtime`) as its JSX runtime — both for server-side HTML rendering and for client-side `mount()`-driven reactivity. Configured via:

- `tsconfig.json`: `"jsx": "react-jsx"`, `"jsxImportSource": "kerfjs"`
- `tsup.config.ts`: esbuild sets `options.jsxImportSource = 'kerfjs'` (both server and client configs)

When writing TSX components, they return `SafeHtml` (which is `JSX.Element`). Import `SafeHtml` and helpers from `kerfjs`:

```ts
import type { SafeHtml } from 'kerfjs';
import { raw } from 'kerfjs';
```

Use `raw()` to inject pre-escaped HTML strings. All string children are auto-escaped. In client code, convert JSX to a DOM element with `toElement(jsx)` (from `src/client/dom.ts`); avoid `document.createElement` and `innerHTML = jsx.toString()`. For in-place reconciliation of an existing DOM subtree against a new JSX template, use `morph(liveRoot, template)` from `kerfjs`.

### Client-Side Code

Client-side CSS and JavaScript are built as separate resources, organized into modular files by concern.

**SCSS** (`src/client/styles/`): Split into partials by concern:

- `_variables.scss` — CSS custom properties (colors, fonts, spacing)
- `_base.scss` — Reset and body/layout defaults
- `_sidebar.scss` — Sidebar, file list, folder tree, filter, progress bar
- `_diff.scss` — Diff view, split/unified modes, hunk separators, line wrapping
- `_annotations.scss` — Annotation rows, categories, forms, drag handles, popups
- `_buttons.scss` — Button base and variants
- `_history.scss` — Review history page
- `_modal.scss` — Modal dialogs
- `_scrollbar.scss` — Custom scrollbar
- `_ai-sort.scss` — Sort mode control, risk badges, score bars, analysis loading
- `_highlight.scss` — Syntax highlight token colors
- `_image-diff.scss` — Image diff modes (metadata, difference, slice) + zoom/pan
- `_settings.scss` — Settings dialog (tabs, theme manager/editor, profile, experimental)
- `_update-banner.scss` — Tauri update notification banner
- `styles.scss` — Entry point, imports all partials

**TypeScript** (`src/client/`): Modular files using TSX and SafeHtml for HTML building:

- `app.tsx` — Entry point, init
- `state.ts` — Shared types, default factories, and `CATEGORIES` constants (no runtime state — see `stores/`)
- `stores/index.ts` — Reactive state via kerfjs `defineStore`: `reviewStore`, `diffViewStore`, `aiStore`, `dragStore`. Reads use `store.state.value.X`; writes use `store.actions.update({ X: y })` plus named actions for collection mutations (`pushFileOrder`, `setAnnotationCount`, `setStaleCount`, `addCollapsedFolder`, `removeCollapsedFolder`, `setFileNote`, `setGuidedNote`, `setAnalysisState`). `getAnalysisModeState(mode)` resolves a mode's analysis sub-state. Computed: `filteredFiles`, `aiEnabled`. New per-concern state goes here; pick the matching store or split a new one off when it's clearly a separate domain.
- `api.ts` — API helper, HTML escaping utility
- `sidebar/index.tsx` — `initSidebar()` orchestrator: two kerf `mount()` trees (sort control + file list), `delegate()` handlers for every sidebar interaction, `effect()`-driven auto-scroll-to-selected
- `sidebar/fileListView.tsx` — JSX for folder / risk / narrative file lists (keyed with `data-key`)
- `sidebar/sortControl.tsx` — JSX for the sort-mode segmented control and risk dimension select
- `sidebar/sortMode.tsx` — Analysis polling logic: `switchSortMode`, `triggerAnalysis`, `loadAnalysisResults`, `invalidateAnalysisCache`
- `sidebar/riskPopover.tsx` — Per-file risk dimension popover
- `sidebar/fileTree.tsx` — `loadFiles()` API call (populates `reviewStore`)
- `diff/index.tsx` — `initDiffView()` orchestrator: kerf `mount()` onto `#diff-container`, async fetch effect that requests `/file/:id` when `(currentFileId, diffMode, ignoreWhitespace, svgViewMode)` change, post-render effect that runs highlight + outline + annotation binding + AI notes, and `delegate()` handlers for hunk-separator clicks, diff-line clicks → annotation form, and drag-and-drop. The mount renders a single `<div data-key="gen-N" data-morph-skip>{raw(html)}</div>` wrapper — the server-rendered diff HTML lives under `data-morph-skip` so highlight.js, hunk expansion, and image-diff widgets can mutate it freely without kerf undoing them. Bumping the generation forces the whole subtree to be replaced (file/mode/whitespace switch).
- `diff/selection.ts` — `selectFile()`: updates `currentFileId`, navStack, marks-as-reviewed. All DOM/fetch work flows through the diff mount.
- `diff/hunkExpander.tsx` — `handleHunkExpand(el)`: surgical `replaceWith()` to splice fetched context lines into the live tree (safe under `data-morph-skip`).
- `diff/imageDiff/` — Image comparison: `index.ts` (orchestration + zoom wiring), `zoom.ts` (zoom state via `WeakMap`, pan, clamp), `sliceTool.ts` (slice geometry + clip-path), `metadata.ts` (metadata diff loading). Runs imperatively inside the morph-skipped diff content.
- `annotations/events.tsx` — `bindAnnotationEvents(diffContainer)` registers `delegate()` handlers for every annotation interaction (delete / edit / dblclick-to-edit / reclassify / keep / dragstart / textarea input / Ctrl+Enter save / Escape cancel). No per-element `addEventListener`.
- `annotations/form.tsx` — `bindCreateFormEvents(diffContainer)` registers the create-form delegates; `showAnnotationForm()` inserts the form DOM and seeds the edit-form signal.
- `annotations/render.tsx` — `buildAnnotationItemHtml(annotation)` + `renderAnnotationInline()`. Each annotation row carries `data-key={id}` for kerf morph identity.
- `annotations/reclassifyPopup.tsx` — Shared category-picker popup used by both the row-level reclassify badge and the edit/create form badge.
- `annotations/categories.tsx` — `buildCategoryBadge(value)` + re-exports of the picker entry points. The picker open state lives in `categoryPickerSignal` in `stores/index.ts`; mid-edit form content/category lives in `editFormSignal` (not in DOM, so a sibling annotation update doesn't clobber an open form).
- `review/modal.tsx` — Completion modal driven by `stage = signal<ModalStage>` + kerf `mount()` on the modal element. The three stages (`stale-prompt`, `completing`, `done`) render different JSX from the same render fn; `delegate()` on the overlay handles every interaction (cancel / discard stale / keep stale / done / copyable / gitignore add or dismiss / send to Claude). Complete/Reopen toolbar buttons are wired via `delegate(.review-app, …)` so the freshly-inserted Reopen button doesn't need re-binding.
- `review/progress.tsx` — Progress bar is now reactive. `initProgress()` creates the bar once (idempotent) and registers an `effect()` over `reviewStore.state.value.files`. Adding/removing a file or marking one as reviewed updates the fill width + summary text automatically — no more manual `updateProgress()` calls.
- `settings/dialog.tsx` — Settings modal driven by a single kerf `mount()`. Per-dialog `ui = signal<SettingsUIState>` holds the live form state; centralized `delegate()` handlers cover every tab interaction (tab switch, theme select, platform/model picker, API key save/remove, guided/channel checkboxes, profile tags, share link, app-name input, updates check). Auto-save uses debounced timers. Each tab is a pure JSX-returning `render(ctx)`; `bind()` is no longer used. Theme editor (`themeEditor.tsx`) uses `signal<Record<string,string>>` for the in-progress colors plus an `effect()` that pushes CSS custom properties to `document.documentElement` for live preview.
- `dom.ts` — `toElement()` helper for converting JSX to DOM elements

Both are served as static files via `/static/styles.css` and `/static/app.js` routes in `src/server.ts`. The JSX runtime is shared between server and client builds.

### Database

Raw PGLite queries (no ORM). Six tables:

- `reviews` — review sessions (repo, mode, status)
- `review_files` — files in each review (with serialized diff JSON)
- `annotations` — line-level annotations with categories
- `ai_analyses` — AI analysis runs (per review, risk or narrative)
- `ai_file_scores` — per-file AI scores and ordering
- `user_preferences` — sort mode, risk dimension, score visibility

### Annotation Categories

- `bug` — code defect
- `fix` — specific fix needed
- `style` — stylistic preference
- `pattern-follow` — good pattern to replicate
- `pattern-avoid` — anti-pattern to stop using
- `note` — informational
- `remember` — should be persisted to AI config (CLAUDE.md, .cursorrules, etc.)

## Build

```bash
npm run build          # tsup -> dist/cli.js + dist/client/app.global.js + dist/client/styles.css
npm run build:client   # Build only client assets (JS + CSS) into dist/client/
npm run dev            # Build client assets, then run via tsx
npm run tauri:dev      # Build client + run Node server + Tauri window (dev mode)
npm run tauri:build    # Build sidecar + package native desktop app
```

The build produces:

- `dist/cli.js` — Server ESM bundle with Node shebang. External deps (`@electric-sql/pglite`, `hono`, `@hono/node-server`, `@resvg/resvg-wasm`, `@modelcontextprotocol/sdk`, `kerfjs`) are kept external.
- `dist/client/app.global.js` — Client JS bundle (IIFE, minified, es2020 target)
- `dist/client/styles.css` — Compiled and compressed CSS from SCSS

### External Dependencies and Production Builds

**CRITICAL**: When adding a new server-side npm dependency that is kept external (not bundled by tsup), you MUST update **three places** or the production desktop app will break:

1. **`tsup.config.ts`** — Add to the `noExternal` exclusion regex so tsup keeps it external (e.g., `/^(?!@electric-sql|hono|@hono|@resvg)/`)
2. **`scripts/build-sidecar.sh`** — Add to the `for pkg in ...` loop that copies external deps into the sidecar's `node_modules/`
3. **This section** — Update the list above

In dev mode (`npm run dev` or `tauri:dev`), external packages resolve from the project's `node_modules/` automatically. In production Tauri builds, the sidecar runs from `src-tauri/server/` with only the explicitly copied packages available. Forgetting step 2 causes "module not found" errors that only appear in production.

Current external deps: `@electric-sql/pglite`, `hono`, `@hono/node-server`, `@resvg/resvg-wasm`, `@modelcontextprotocol/sdk`, `kerfjs` (pulls in `@preact/signals-core`)

## Testing

```bash
npm test              # Unit tests with coverage (vitest)
npm run test:e2e      # E2E tests (Playwright, Chromium)
npm run test:all      # Unit + E2E with merged coverage report (lcov + genhtml)
```

### Testing Philosophy

- **Double coverage**: Every feature should be covered by both unit tests and E2E tests. Unit tests verify individual functions in isolation; E2E tests verify the full stack works end-to-end in a real browser. Neither alone is sufficient — unit tests can pass while the real UI is broken (e.g., incorrect API call serialization, CSS issues, event wiring bugs).
- **E2E tests are not optional**: If a feature involves user interaction (clicking, typing, navigating), it must have E2E tests that exercise the real UI against a running server. E2E tests catch integration bugs that unit tests with mocked boundaries cannot.
- **Unit tests mock at boundaries, E2E tests don't**: Unit tests mock database, filesystem, and external APIs. E2E tests run against the real server with a real database (demo mode) and real browser rendering. The only thing E2E tests don't test is external AI API calls.
- **Coverage merging**: `npm run test:all` collects V8 coverage from the server process (via `NODE_V8_COVERAGE`), browser coverage (via Playwright's `page.coverage` API with esbuild source maps), and unit test coverage (vitest), then merges all three as lcov files via concatenation and generates a combined HTML report with `genhtml`.

### Test Infrastructure

- `vitest.config.ts` — Unit test config, excludes `tests/e2e/`, coverage via `@vitest/coverage-v8`
- `playwright.config.ts` — E2E config, Chromium only, starts the server in demo mode (`--demo:4 --ai-service-test`) on port 4183. The `--ai-service-test` flag mocks AI analysis and bypasses the API-key check so the suite is hermetic (never makes real AI calls, never depends on a key existing on the machine).
- `tests/e2e/coverage-fixture.ts` — Playwright fixture that collects browser V8 coverage per test
- `tests/e2e/memoryHelper.ts` — Heap-stability helpers (`measureHeap`, `expectStableHeap`) used by `stability.test.ts`. Forces V8 GC via CDP and reads `performance.memory.usedJSHeapSize` to assert that repeated interaction (file switching, modal open/close, sort-mode cycling) doesn't grow the heap proportionally with iteration count — catches per-cycle DOM / listener retention of the GB-800 / GB-748 class.
- `scripts/test-all.sh` — Orchestrates unit + E2E runs and merges coverage
- `scripts/test-e2e-coverage.sh` — Manages server lifecycle for E2E coverage collection
- `scripts/test-e2e-docker.sh` (`npm run test:e2e:docker`) — Runs the Playwright e2e suite inside the same `mcr.microsoft.com/playwright:vX.Y.Z-noble` Linux image CI uses (version pinned from `package.json`), so a local sweep reproduces CI faithfully — including environment-dependent failures (no macOS keychain → no API key, Linux paths/fonts, `/dev/shm` size). Mounts the repo read-write but shadows `node_modules` with an anonymous volume so the container's Linux-native binaries don't clobber the host's. Pass-through args go to `playwright test` (e.g. `npm run test:e2e:docker -- stability.test.ts`). Requires Docker running.

## Conventions

- ESM modules (`"type": "module"` in package.json)
- Import paths use `.js` extension (TypeScript convention for ESM)
- No ORM — raw SQL queries via PGLite's `query()` method
- IDs are generated with `Date.now().toString(36) + Math.random().toString(36).slice(2, 10)`
- Hono context variables (`reviewId`, `repoRoot`) are typed via `AppEnv` in `src/types.ts`
- Server-rendered HTML for initial page load; client JS for interactivity
- Client CSS and JS are built separately and served as static files — never inlined in layout
- **Always use American-English spelling and grammar** in all source files — code, comments, identifiers, log/error messages, UI strings, documentation, and commit messages. Prefer `color`/`behavior`/`canceled`/`canceling`/`finalize`/`organize`/`customize`/`optimize`/`analyze`/`initialize`/`center`/`gray` over their British variants (`colour`/`behaviour`/`cancelled`/`cancelling`/`finalise`/`organise`/`customise`/`optimise`/`analyse`/`initialise`/`centre`/`grey`). This applies equally to TypeScript, Rust, SCSS, Markdown, and shell scripts.

## Ticket-Driven Work

> **Hot Sheet tickets are local-only.** The `.hotsheet/` directory is gitignored and lives only on the project maintainer's machine. Ticket IDs (e.g. `GB-774`) are meaningless to anyone else and there is no shared issue tracker to look them up in.
>
> This has two consequences for everything you write:
>
> 1. **Never tell a reader to "see `.hotsheet/`", "check the worklist", or "look up GB-N"** in committed files — code comments, requirements docs, architecture docs, AI summaries, commit messages, PR descriptions, etc. Those references go nowhere for any other reader.
> 2. **A bare ticket number is not context.** If a code comment or doc needs to reference past work, write the reasoning inline. If a ticket ID is included at all, it must be accompanied by a short, self-contained summary of what the ticket was about — written so a reader who can't open the ticket still understands the point. Prefer dropping the ID entirely when the summary already conveys the why.
>
> Both rules apply to **committed files** (code, docs, commit messages, PR descriptions). They do **not** apply when writing inside Hot Sheet itself — ticket notes, ticket details, and other Hot-Sheet-only surfaces can reference sibling tickets by bare ID freely, since any reader who is seeing a ticket already has Hot Sheet available to look the reference up.
>
> This section itself, and any other guidance about how *you* should interact with the local Hot Sheet workflow, is the exception — it is addressed to the AI assistant running against the maintainer's machine.

When the user gives you work directly via the CLI (not via MCP channel or Hot Sheet events), analyze the request and create Hot Sheet tickets before starting implementation — especially for substantial or multi-step work. This keeps work visible, trackable, and consistent with the Hot Sheet workflow.

- **Do create tickets** for: feature implementation, bug fixes, refactoring, multi-step tasks, anything that involves changing code.
- **Don't create tickets** for: simple questions, git commits, quick lookups, trivial one-line changes.
- **When in doubt, create the tickets.** The overhead is minimal and the tracking value is high.
- Use the Hot Sheet API to create tickets, mark them as Up Next, then work through them normally (set status to "started", implement, set to "completed" with notes).
- **Always create follow-up tickets** for work that isn't completed in the current session: unfinished implementation steps, open design questions needing answers, known gaps discovered during work, features designed but not yet built (e.g., a requirements doc without implementation). Never leave follow-up work undocumented — if it's not in a ticket, it will be forgotten.
- **Incomplete work checklist** — before marking a ticket as completed, verify:
  1. **No placeholder text in the UI** (e.g., "coming soon", "coming in a future update") without a corresponding follow-up ticket
  2. **No TODO/FIXME comments** in the code without a corresponding follow-up ticket
  3. **No requirements doc items** that were documented but not implemented without follow-up tickets
  4. **No empty/stub functions** that return mock data or do nothing without follow-up tickets
  If any of the above exist, create the follow-up tickets BEFORE marking the current ticket as completed.
- **Use FEEDBACK NEEDED before deferring or asking about follow-up tickets.** When you're about to (a) defer a ticket because it needs more work, (b) ask the user whether to file follow-up tickets, or (c) close a ticket with a question buried in the notes ("let me know if you want X" / "happy to do Y if you want"), DO NOT close it that way. Instead, leave the ticket in `started` status and add a `FEEDBACK NEEDED:` note (per `.hotsheet/worklist.md`), then signal channel done and wait for the user. Closing with an unanswered question buries the question and the user can't easily see it. The FEEDBACK NEEDED mechanism is the only way to reliably get attention on a question.

### Code Organization

- **One primary export per file** — each file should have one main exported function/concept, with supporting private (non-exported) functions as needed
- **Files should not be excessively long** — break up large files by concern into smaller, focused modules
- **Use sub-folders for specialization** — group related modules under descriptive directories (e.g., `sidebar/`, `diff/`, `annotations/`, `review/`)
- **SCSS uses partials** — split into `_partial.scss` files by concern, imported from a single entry point
- **Use TSX/SafeHtml for HTML building** — client-side code that builds HTML strings should use the JSX runtime (`.tsx` files) rather than manual string concatenation. Use `raw()` from `kerfjs` for pre-rendered HTML strings in JSX
- **Use `toElement()` instead of `document.createElement()`** — when creating DOM elements in client code, use the `toElement()` helper from `dom.ts` with JSX: `toElement(<div className="foo">bar</div>)`. Resolve JSX to DOM elements only at the last moment. Never use `document.createElement()` directly

### Client reactivity conventions (kerfjs)

The client uses **kerfjs** for state, render, and event delegation. Follow these patterns when writing new client features:

- **State lives in `defineStore` modules** in `src/client/stores/index.ts` (`reviewStore`, `diffViewStore`, `aiStore`, `dragStore`), plus per-feature `signal()` instances for transient UI state (e.g. `editFormSignal`). Do not introduce module-scope mutable objects.
- **Per-modal-session signals are a sanctioned exception to "state lives in module-scope signals or stores."** Imperative `show*Modal()` openers (`showSettingsDialog`, `showThemeManager`, `showThemeEditor`, `showCompleteModal`) declare their reactive state as a local `signal()` inside the opener's closure, then pass the signal *value* (not the signal ref) into the JSX-returning render function consumed by `mount()`. This is intentional and is NOT a kerf Rule 6 violation: the opener is not a JSX-returning component, the render function doesn't close over the signal, and per-session lifetime is exactly what these transient modals want — every open should start fresh, and the signal is disposed when the modal closes via `overlay.remove()` + `disposeMount()`. Hoisting these to module scope would create stale-state-on-reopen footguns; keep them local.
- **Re-renders happen via `mount()`**, not by manually calling rebuild functions. `mount(rootEl, () => renderJsx())` re-runs the render fn whenever a signal it reads changes, and morphs the live tree against the new template. If you find yourself writing `el.innerHTML = jsx.toString()` and then a re-bind step, you want `mount()` (or `morph()` for one-shot reconciliation).
- **Event handlers use `delegate()` / `delegateCapture()`** from a single stable root per surface (`sidebar`, `#diff-container`, modal overlay, etc.). Inside a `mount()` tree, per-element `addEventListener` silently disappears on the next re-render. The exceptions — same precedent across every phase — are `document`-level listeners for drag lifecycle, popup outside-click dismiss, and global keyboard shortcuts.
- **List items must carry `data-key`** (or a stable `id`). Required for kerf's keyed reconciler to preserve identity across re-renders. Without a key, items match positionally by tag name — fine for static lists, broken for anything that reorders.
- **`data-morph-skip`** is the escape hatch for library-owned subtrees (the diff content where highlight.js / hunk expansion / image-diff zoom mutate the DOM imperatively). `data-morph-skip-children` keeps the element's attributes morphing but leaves the subtree alone (for server-rendered shells whose loading-state classes still need to flow). `data-morph-preserve` keeps an imperatively-injected child surviving the trailing-removal pass when the new template doesn't emit it. See `docs/4-render.md` in the kerfjs repo for the full taxonomy.

When a feature touches DOM state that should survive re-renders (input focus + value, contenteditable cursor, `<details open>` state), kerf preserves these automatically during morph — you don't need to manage them imperatively. See kerfjs §4.4.
