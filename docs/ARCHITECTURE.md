# Glassbox Architecture

Glassbox is a locally-running web application for reviewing AI-generated code. It launches from the CLI inside a git repository, opens a browser-based diff viewer where users annotate lines with categorized feedback, and exports structured markdown that AI tools can act on.

## System overview

```
┌─────────────────────────────────────────────────────────────┐
│ CLI (src/cli.ts)                                            │
│ - Parses args, determines review mode                       │
│ - Runs git commands to collect file diffs                   │
│ - Creates review record in PGLite                           │
│ - Starts HTTP server                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Hono HTTP Server (src/server.ts)                            │
│ - Serves static client assets (/static/app.js, styles.css) │
│ - JSON API routes (/api/*)                                  │
│ - AI analysis routes (/api/ai/*)                            │
│ - Server-rendered HTML pages (/)                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Client (src/client/)                                        │
│ - Custom JSX runtime (no React) — SafeHtml class            │
│ - Diff viewer with split/unified modes                      │
│ - Annotation system with drag-and-drop                      │
│ - AI-powered file sorting (risk, narrative)                  │
│ - Communicates with server via fetch()                       │
└─────────────────────────────────────────────────────────────┘
```

## Key components

### CLI entry point (`src/cli.ts`)

Parses command-line arguments to determine the review mode:

- `--uncommitted` (default), `--staged`, `--unstaged` — working tree changes
- `--commit <sha>`, `--range <from>..<to>`, `--branch <name>` — historical changes
- `--files <patterns>`, `--all` — specific files or entire codebase
- `--demo:N` — pre-configured demo scenarios (bypasses git)

Checks for existing in-progress reviews (same HEAD → update diffs; `--resume` → reopen).

### Server (`src/server.ts`)

Hono HTTP server on port 4183. Injects `reviewId`, `currentReviewId`, and `repoRoot` into the request context via middleware. Tries up to 20 ports if the default is in use (unless `--strict-port`).

### Routes

- `src/routes/api.ts` — Annotations CRUD, file status updates, review management
- `src/routes/ai-api.ts` — AI analysis (risk scoring, narrative ordering), config, preferences
- `src/routes/pages.tsx` — Server-rendered HTML pages using custom JSX

### Database (`src/db/`)

PGLite (embedded PostgreSQL compiled to WASM). Data stored in `~/.glassbox/data/`. Raw SQL queries, no ORM.

**Tables:**

- `reviews` — review sessions (repo, mode, status)
- `review_files` — files in each review (with serialized diff JSON)
- `annotations` — line-level annotations with categories
- `ai_analyses` — AI analysis runs (per review, risk or narrative)
- `ai_file_scores` — per-file AI scores and ordering
- `user_preferences` — sort mode, risk dimension, score visibility

### AI integration (`src/ai/`)

- `config.ts` — API key resolution: environment → keychain → config file
- `client.ts` — Unified HTTP client for Anthropic, OpenAI, and Google AI APIs
- `context-builder.ts` — Builds diff context payloads for AI analysis
- `analyze-risk.ts` — Risk analysis with multi-turn context loop
- `analyze-narrative.ts` — Narrative ordering with multi-turn context loop
- `models.ts` — Curated model lists per platform

### Git operations (`src/git/diff.ts`)

Generates diffs for each review mode. Handles file listing, diff parsing, repo root detection, and HEAD commit resolution.

### Export (`src/export/generate.ts`)

Generates `.glassbox/latest-review.md` on review completion — structured markdown that AI tools (Claude Code, Cursor, etc.) can read and act on.

### Client architecture (`src/client/`)

Modular TypeScript files organized by concern. Every surface follows the same pattern: state in `defineStore` modules (`stores/index.ts`), re-render via kerf `mount()` rooted at a stable container, events via `delegate(root, …)`, list items keyed with `data-key`.

- `stores/index.ts` — `reviewStore`, `diffViewStore`, `aiStore`, `dragStore` (kerf `defineStore`), plus `editFormSignal` and `categoryPickerSignal` for transient UI state. Computed: `filteredFiles`, `visibleFileOrder`, `aiEnabled`. New client state goes here.
- `sidebar/` — Sort control + file list mounted reactively via kerf; all interactions delegated at the sidebar root.
- `diff/` — One `mount()` on `#diff-container`; fetched diff HTML lives under `data-morph-skip` so highlight.js, hunk expansion, and image-diff widgets can mutate it imperatively. Delegated events for line clicks, hunk expand, drag-and-drop.
- `annotations/` — `bindAnnotationEvents()` + `bindCreateFormEvents()` register every annotation interaction via `delegate()`. Edit-form content lives in a `signal` so a sibling annotation update doesn't clobber an open form.
- `review/` — Completion modal driven by `stage = signal<ModalStage>` + `mount()`; progress bar updates reactively via `effect()` over `reviewStore.state.value.files`.
- `settings/` — Settings dialog mounted reactively; centralized delegated handlers per tab. Theme editor live-preview is a kerf `effect()` over the in-progress colors signal.
- `dom.ts` — `toElement()` helper converts JSX to DOM elements at the last moment. Never use `document.createElement` directly.

### JSX runtime

Provided by **kerfjs** (`kerfjs/jsx-runtime`). Shared between server (page rendering via the SSR helpers) and client (`mount()`-driven reactivity and one-shot `toElement` / `morph` calls). Auto-escapes string children; use `raw()` for pre-escaped HTML strings. `tsconfig.json` and `tsup.config.ts` set `jsxImportSource: 'kerfjs'`.

## Client conventions

- **State lives in `defineStore` modules**, not in module-scope mutable objects.
- **Re-renders happen via `mount()`**, not by manually calling rebuild functions. Manual `renderX()` callsites scattered through the codebase are a smell.
- **Event handlers use `delegate()` / `delegateCapture()`** from a single stable root per surface. Per-element `addEventListener` inside a `mount()` tree silently disappears on the next re-render. Document-level listeners for drag-lifecycle / popup-dismiss / global keyboard shortcuts are fine.
- **List items must carry `data-key`** (or a stable `id`). Required for morph identity preservation across re-renders.
- **`data-morph-skip`** is the escape hatch for library-owned subtrees that kerf must not touch (e.g. the server-rendered diff content with highlight.js, image-diff zoom widgets). Use `data-morph-skip-children` when the host's attributes must keep flowing but the subtree is client-owned. Use `data-morph-preserve` for imperatively-injected children that aren't in the JSX template.

## Build pipeline

Uses tsup to produce two bundles:

1. **Server** (`dist/cli.js`) — ESM, Node 20 target, shebang. External deps: `@electric-sql/pglite`, `hono`, `@hono/node-server`, `@resvg/resvg-wasm`, `@modelcontextprotocol/sdk`, `kerfjs` (pulls in `@preact/signals-core`).
2. **Client** (`dist/client/app.global.js`) — IIFE, es2020, minified. SCSS compiled separately via sass. Separate entry `dist/client/history.global.js` for the review-history page.

Both bundles use the kerfjs JSX runtime via `tsup.config.ts`'s `options.jsxImportSource = 'kerfjs'` setting.

## Annotation categories

- `bug` — code defect
- `fix` — specific fix needed
- `style` — stylistic preference
- `pattern-follow` — good pattern to replicate
- `pattern-avoid` — anti-pattern to stop using
- `note` — informational
- `remember` — should be persisted to AI config (CLAUDE.md, .cursorrules, etc.)
