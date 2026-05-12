# Glassbox

## Project Overview

A locally-running web application for reviewing AI-generated code. Launched from the CLI inside any git repository, it opens a browser-based diff viewer where users annotate lines with categorized feedback. On completion, annotations are exported as structured markdown that AI tools (Claude Code, Cursor, etc.) can read and act on.

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript (strict mode)
- **Server**: Hono framework with `@hono/node-server`
- **Desktop**: Tauri v2 (Rust) — wraps the Node.js server in a native window
- **Database**: PGLite (embedded PostgreSQL) — data stored in `~/.glassbox/data/`
- **Rendering**: Custom server-side JSX runtime (no React) — produces HTML strings via `SafeHtml` class
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

- `src/cli.ts` — CLI entry point, arg parsing
- `src/server.ts` — Hono app setup, middleware injection
- `src/routes/api.ts` — JSON API (annotations CRUD, file status, review management)
- `src/routes/ai-api.ts` — AI analysis, configuration, and preferences API
- `src/routes/pages.tsx` — Server-rendered HTML pages
- `src/components/` — TSX components (layout, diffView, fileList, reviewHistory)
- `src/db/connection.ts` — PGLite setup and schema initialization (raw SQL, no ORM)
- `src/db/queries.ts` — All database operations
- `src/db/ai-queries.ts` — AI analysis and preferences database operations
- `src/ai/models.ts` — Curated AI model lists per platform (CHECK DAILY: keep model IDs and names up to date with latest releases from Anthropic, OpenAI, and Google)
- `src/ai/config.ts` — API key resolution (env → keychain → config file) and config management
- `src/ai/client.ts` — Unified HTTP client for Anthropic, OpenAI, and Google AI APIs
- `src/ai/context-builder.ts` — Builds diff context payloads for AI analysis
- `src/ai/analyze-risk.ts` — Risk analysis orchestration with multi-turn context loop
- `src/ai/analyze-narrative.ts` — Narrative ordering analysis with multi-turn context loop
- `src/git/diff.ts` — Git operations: diff generation, parsing, file listing
- `src/git/image.ts` — Image diff support: old/new image retrieval from git, metadata extraction from headers
- `src/git/svg-rasterize.ts` — SVG to PNG rasterization using `@resvg/resvg-wasm` for rendered comparison mode
- `src/themes/built-in.ts` — Built-in theme definitions (Dark, Light, High Contrast, Dracula, Tokyo Night), ThemeColors type
- `src/themes/config.ts` — Theme persistence: active theme in config.json, custom themes in ~/.glassbox/themes/
- `src/routes/theme-api.ts` — Theme REST API: list, get/set active, create/update/delete custom themes
- `src/client/themes.ts` — Client-side theme switching: applyThemeColors(), switchTheme()
- `src/export/generate.ts` — Generates `.glassbox/latest-review.md` on review completion
- `src/jsx-runtime.ts` — Custom JSX runtime (server-side HTML string generation)
- `src/types.ts` — Shared Hono environment types
- `src-tauri/` — Tauri desktop app (Rust backend, loading screens, CLI wrappers) — see `docs/tauri-architecture.md`

### JSX Runtime

The project uses a custom JSX runtime (`src/jsx-runtime.ts`) instead of React. It renders JSX to HTML strings via the `SafeHtml` class. This runtime is shared by both the server-side components and client-side modules. Configured via:

- `tsconfig.json`: `"jsx": "react-jsx"`, `"jsxImportSource": "#jsx"`
- `package.json` imports map: `"#jsx/jsx-runtime": "./src/jsx-runtime.ts"`
- `tsup.config.ts`: esbuild alias resolves `#jsx/jsx-runtime` at build time (both server and client configs)

When writing TSX components, they return `SafeHtml` (which is `JSX.Element`). Use `raw()` to inject pre-escaped HTML strings. All string children are auto-escaped. In client code, convert JSX to string for `innerHTML` with `.toString()`.

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
- `_settings.scss` — AI settings dialog styles
- `styles.scss` — Entry point, imports all partials

**TypeScript** (`src/client/`): Modular files using TSX and SafeHtml for HTML building:

- `app.ts` — Entry point, init
- `state.ts` — Shared types, default factories, and `CATEGORIES` constants (no runtime state — see `stores/`)
- `stores/index.ts` — Reactive state via kerfjs `defineStore`: `reviewStore`, `diffViewStore`, `aiStore`, `dragStore`. Reads use `store.state.value.X`; writes use `store.actions.update({ X: y })` plus named actions for collection mutations (`pushFileOrder`, `setAnnotationCount`, `setStaleCount`, `addCollapsedFolder`, `removeCollapsedFolder`, `setFileNote`, `setGuidedNote`, `setAnalysisState`). `getAnalysisModeState(mode)` resolves a mode's analysis sub-state. Computed: `filteredFiles`, `aiEnabled`. New per-concern state goes here; pick the matching store or split a new one off when it's clearly a separate domain.
- `api.ts` — API helper, HTML escaping utility
- `sidebar/fileTree.tsx` — File tree rendering, sort mode dispatch
- `sidebar/sortMode.tsx` — Sort mode segmented control (folder/risk/narrative)
- `sidebar/riskView.tsx` — Risk-sorted file list with score badges and popovers
- `sidebar/narrativeView.tsx` — Narrative-ordered file list with position numbers
- `sidebar/controls.ts` — File filter, sidebar resize, keyboard navigation
- `diff/selection.ts` — File selection
- `diff/hunkExpander.tsx` — Context expansion
- `diff/lineClicks.ts` — Diff line click handling
- `diff/mode.ts` — Diff mode toggle, wrap toggle, scroll sync
- `diff/imageDiff/` — Image comparison split by concern: `index.ts` (orchestration + zoom wiring), `zoom.ts` (zoom state via `WeakMap`, pan, clamp), `sliceTool.ts` (slice geometry + clip-path), `metadata.ts` (metadata diff loading)
- `diff/dragDrop.ts` — Annotation drag-and-drop
- `annotations/form.tsx` — Annotation creation form
- `annotations/render.tsx` — Annotation inline rendering
- `annotations/events.tsx` — Annotation CRUD events, reclassify, edit
- `annotations/categories.tsx` — Category badge and picker UI
- `review/modal.tsx` — Completion modal, gitignore prompts
- `review/progress.tsx` — Progress bar
- `settings/dialog.tsx` — AI settings modal (platform, model, API key configuration)
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

- `dist/cli.js` — Server ESM bundle with Node shebang. External deps (`@electric-sql/pglite`, `hono`, `@hono/node-server`, `@resvg/resvg-wasm`) are kept external.
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
- `playwright.config.ts` — E2E config, Chromium only, starts server in demo mode on port 4183
- `tests/e2e/coverage-fixture.ts` — Playwright fixture that collects browser V8 coverage per test
- `scripts/test-all.sh` — Orchestrates unit + E2E runs and merges coverage
- `scripts/test-e2e-coverage.sh` — Manages server lifecycle for E2E coverage collection

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
- **Use TSX/SafeHtml for HTML building** — client-side code that builds HTML strings should use the JSX runtime (`.tsx` files) rather than manual string concatenation. Use `raw()` for pre-rendered HTML strings in JSX
- **Use `toElement()` instead of `document.createElement()`** — when creating DOM elements in client code, use the `toElement()` helper from `dom.ts` with JSX: `toElement(<div className="foo">bar</div>)`. Resolve JSX to DOM elements only at the last moment. Never use `document.createElement()` directly
