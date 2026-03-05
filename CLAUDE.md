# Glassbox

## Project Overview

A locally-running web application for reviewing AI-generated code. Launched from the CLI inside any git repository, it opens a browser-based diff viewer where users annotate lines with categorized feedback. On completion, annotations are exported as structured markdown that AI tools (Claude Code, Cursor, etc.) can read and act on.

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript (strict mode)
- **Server**: Hono framework with `@hono/node-server`
- **Database**: PGLite (embedded PostgreSQL) — data stored in `~/.glassbox/data/`
- **Rendering**: Custom server-side JSX runtime (no React) — produces HTML strings via `SafeHtml` class
- **Build**: tsup (bundles all source into a single `dist/cli.js`)
- **Dev**: tsx for direct TypeScript execution

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

The project uses a custom JSX runtime (`src/jsx-runtime.ts`) instead of React. It renders JSX to HTML strings via the `SafeHtml` class. Configured via:
- `tsconfig.json`: `"jsx": "react-jsx"`, `"jsxImportSource": "#jsx"`
- `package.json` imports map: `"#jsx/jsx-runtime": "./src/jsx-runtime.ts"`
- `tsup.config.ts`: esbuild alias resolves `#jsx/jsx-runtime` at build time

When writing TSX components, they return `SafeHtml` (which is `JSX.Element`). Use `raw()` to inject pre-escaped HTML strings. All string children are auto-escaped.

### Client-Side JavaScript

All client JS is inlined in `src/components/layout.tsx` via the `getClientScript()` function. It's vanilla JS (no framework, no build step). This handles:
- File selection and navigation (j/k keyboard shortcuts)
- Diff line click -> annotation form
- Annotation CRUD (create, edit, delete)
- Diff mode toggling (split/unified)
- Review completion modal
- Progress tracking

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
npm run build    # tsup -> dist/cli.js (single file, ~60KB)
npm run dev      # tsx for development (requires --tsconfig flag when run from other dirs)
```

The build produces a single ESM file with Node shebang. External dependencies (`@electric-sql/pglite`, `hono`, `@hono/node-server`) are kept external; all project source is bundled.

## Conventions

- ESM modules (`"type": "module"` in package.json)
- Import paths use `.js` extension (TypeScript convention for ESM)
- No ORM — raw SQL queries via PGLite's `query()` method
- IDs are generated with `Date.now().toString(36) + Math.random().toString(36).slice(2, 10)`
- Hono context variables (`reviewId`, `repoRoot`) are typed via `AppEnv` in `src/types.ts`
- Server-rendered HTML for initial page load; client JS for interactivity
- CSS is inlined in the layout component (no separate CSS files or build step)
