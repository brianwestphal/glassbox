# Glassbox

## Project Overview

A locally-running web application for reviewing AI-generated code. Launched from the CLI inside any git repository, it opens a browser-based diff viewer where users annotate lines with categorized feedback. On completion, annotations are exported as structured markdown that AI tools (Claude Code, Cursor, etc.) can read and act on.

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript (strict mode)
- **Server**: Hono framework with `@hono/node-server`
- **Database**: PGLite (embedded PostgreSQL) — data stored in `~/.glassbox/data/`
- **Rendering**: Custom server-side JSX runtime (no React) — produces HTML strings via `SafeHtml` class
- **Build**: tsup (server CLI + client JS bundles) + sass (SCSS → CSS)
- **Dev**: tsx for direct TypeScript execution (client assets pre-built)

## Architecture

The app is a single-entry CLI (`src/cli.ts`) that:
1. Parses CLI args to determine review mode (uncommitted, staged, commit, branch, etc.)
2. Runs git commands to collect file diffs
3. Creates a review record in PGLite
4. Starts a Hono HTTP server on port 4173

### Key Directories

- `src/cli.ts` — CLI entry point, arg parsing
- `src/server.ts` — Hono app setup, middleware injection
- `src/routes/api.ts` — JSON API (annotations CRUD, file status, review management)
- `src/routes/pages.tsx` — Server-rendered HTML pages
- `src/components/` — TSX components (layout, diffView, fileList, reviewHistory)
- `src/db/connection.ts` — PGLite setup and schema initialization (raw SQL, no ORM)
- `src/db/queries.ts` — All database operations
- `src/git/diff.ts` — Git operations: diff generation, parsing, file listing
- `src/export/generate.ts` — Generates `.glassbox/latest-review.md` on review completion
- `src/jsx-runtime.ts` — Custom JSX runtime (server-side HTML string generation)
- `src/types.ts` — Shared Hono environment types

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
- `styles.scss` — Entry point, imports all partials

**TypeScript** (`src/client/`): Modular files using TSX and SafeHtml for HTML building:
- `app.ts` — Entry point, init
- `state.ts` — Shared state, types, category constants
- `api.ts` — API helper, HTML escaping utility
- `sidebar/fileTree.tsx` — File tree rendering
- `sidebar/controls.ts` — File filter, sidebar resize, keyboard navigation
- `diff/selection.ts` — File selection
- `diff/hunkExpander.tsx` — Context expansion
- `diff/lineClicks.ts` — Diff line click handling
- `diff/mode.ts` — Diff mode toggle, wrap toggle, scroll sync
- `diff/dragDrop.ts` — Annotation drag-and-drop
- `annotations/form.tsx` — Annotation creation form
- `annotations/render.tsx` — Annotation inline rendering
- `annotations/events.tsx` — Annotation CRUD events, reclassify, edit
- `annotations/categories.tsx` — Category badge and picker UI
- `review/modal.tsx` — Completion modal, gitignore prompts
- `review/progress.tsx` — Progress bar
- `dom.ts` — `toElement()` helper for converting JSX to DOM elements

Both are served as static files via `/static/styles.css` and `/static/app.js` routes in `src/server.ts`. The JSX runtime is shared between server and client builds.

### Database

Raw PGLite queries (no ORM). Three tables:
- `reviews` — review sessions (repo, mode, status)
- `review_files` — files in each review (with serialized diff JSON)
- `annotations` — line-level annotations with categories

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
```

The build produces:
- `dist/cli.js` — Server ESM bundle with Node shebang. External deps (`@electric-sql/pglite`, `hono`, `@hono/node-server`) are kept external.
- `dist/client/app.global.js` — Client JS bundle (IIFE, minified, es2020 target)
- `dist/client/styles.css` — Compiled and compressed CSS from SCSS

## Conventions

- ESM modules (`"type": "module"` in package.json)
- Import paths use `.js` extension (TypeScript convention for ESM)
- No ORM — raw SQL queries via PGLite's `query()` method
- IDs are generated with `Date.now().toString(36) + Math.random().toString(36).slice(2, 10)`
- Hono context variables (`reviewId`, `repoRoot`) are typed via `AppEnv` in `src/types.ts`
- Server-rendered HTML for initial page load; client JS for interactivity
- Client CSS and JS are built separately and served as static files — never inlined in layout

### Code Organization

- **One primary export per file** — each file should have one main exported function/concept, with supporting private (non-exported) functions as needed
- **Files should not be excessively long** — break up large files by concern into smaller, focused modules
- **Use sub-folders for specialization** — group related modules under descriptive directories (e.g., `sidebar/`, `diff/`, `annotations/`, `review/`)
- **SCSS uses partials** — split into `_partial.scss` files by concern, imported from a single entry point
- **Use TSX/SafeHtml for HTML building** — client-side code that builds HTML strings should use the JSX runtime (`.tsx` files) rather than manual string concatenation. Use `raw()` for pre-rendered HTML strings in JSX
- **Use `toElement()` instead of `document.createElement()`** — when creating DOM elements in client code, use the `toElement()` helper from `dom.ts` with JSX: `toElement(<div className="foo">bar</div>)`. Resolve JSX to DOM elements only at the last moment. Never use `document.createElement()` directly
