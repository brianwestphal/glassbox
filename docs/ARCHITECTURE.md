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

Modular TypeScript files organized by concern:

- `sidebar/` — File tree, sort modes (folder/risk/narrative), risk badges
- `diff/` — File selection, hunk expansion, line clicks, split/unified mode
- `annotations/` — Creation form, inline rendering, CRUD events, categories
- `review/` — Completion modal, progress bar
- `settings/` — AI settings dialog (platform, model, API key)
- `dom.ts` — `toElement()` helper converts JSX to DOM elements

All HTML building uses the custom JSX runtime (`.tsx` files) with `SafeHtml`. DOM elements are created via `toElement()`, never `document.createElement()`.

### Custom JSX runtime (`src/jsx-runtime.ts`)

Renders JSX to HTML strings via the `SafeHtml` class. Shared between server (page rendering) and client (DOM building). Auto-escapes string children; use `raw()` for pre-escaped HTML.

## Build pipeline

Uses tsup to produce two bundles:

1. **Server** (`dist/cli.js`) — ESM, Node 20 target, shebang. External deps: `@electric-sql/pglite`, `hono`, `@hono/node-server`
2. **Client** (`dist/client/app.global.js`) — IIFE, es2020, minified. SCSS compiled separately via sass.

Both bundles share the custom JSX runtime via the `#jsx` import alias.

## Annotation categories

- `bug` — code defect
- `fix` — specific fix needed
- `style` — stylistic preference
- `pattern-follow` — good pattern to replicate
- `pattern-avoid` — anti-pattern to stop using
- `note` — informational
- `remember` — should be persisted to AI config (CLAUDE.md, .cursorrules, etc.)
