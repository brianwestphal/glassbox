# 1. Testing Overview

High-level testing strategy for Glassbox — framework, conventions, and coverage goals.

## Framework

Vitest is the recommended test runner. It has native ESM and TypeScript support, fast execution via tsx, built-in mocking, and snapshot testing. It aligns well with the existing build tooling (tsup, esbuild) and the `"type": "module"` package setup.

## Project Structure

```
tests/
  unit/
    git/           — diff parsing, repo detection, file listing
    db/            — query functions, schema, migrations
    ai/            — API clients, config, batch planning, token estimation
    export/        — markdown generation, gitignore logic
    review/        — annotation migration, fuzzy matching
    jsx/           — JSX runtime, escaping, attribute mapping
    outline/       — symbol parsing across languages
    utils/         — escapeHtml, ID generation
  integration/
    api/           — HTTP route testing (Hono test client)
    review/        — full review lifecycle (create → annotate → complete)
    ai/            — analysis orchestration with mocked AI responses
    db/            — schema initialization, migrations, cascade deletes
  e2e/
    workflows/     — CLI → server → browser flows
  fixtures/
    diffs/         — sample unified diff outputs
    ai-responses/  — sample JSON responses from each AI platform
    repos/         — scripts to create temp git repos with known state
```

## Conventions

- **File naming** — `{module}.test.ts` co-located in the `tests/` tree, mirroring the `src/` structure.
- **Test isolation** — Each test file should set up and tear down its own state. No shared mutable state between test files.
- **Database tests** — Use a fresh in-memory PGLite instance per test suite. The `initDatabase()` function already supports custom data directory paths, so tests can use temp directories.
- **Git tests** — Use temporary git repositories created in `beforeAll` hooks. Clean up in `afterAll`.
- **AI tests** — Mock HTTP fetch responses. Never make real API calls in automated tests.
- **File I/O tests** — Use OS temp directories. Clean up after each suite.
- **Snapshots** — Use snapshot testing for markdown export output and JSX rendering, where the expected output is large and stable.

## Coverage Goals

| Category | Target | Rationale |
|----------|--------|-----------|
| Unit tests | 80%+ line coverage | Core logic (parsing, queries, migration) should be well-covered |
| Integration tests | Key workflows covered | Review lifecycle, API routes, and AI orchestration paths |
| E2E tests | Critical user paths | CLI launch, annotate-and-export, resume review |

Focus coverage on code that is hard to verify manually or has caused regressions in the past. Pure utility functions and parsers should have near-100% coverage. Thin wrappers around external APIs need less.

### Current Coverage (as of 2026-03-15)

231 tests across 11 test files. Key module coverage:

| Module | Stmts | Lines | Notes |
|--------|-------|-------|-------|
| `src/db/queries.ts` | 100% | 100% | Full CRUD coverage |
| `src/db/ai-queries.ts` | 97% | 100% | All AI analysis + preferences |
| `src/routes/api.ts` | 99% | 99% | All endpoints including project settings |
| `src/git/diff.ts` | 92% | 94% | Unit + integration with temp repos |
| `src/outline/parser.ts` | 87% | 93% | All languages + template literals |
| `src/review-update.ts` | 99% | 100% | Annotation migration + fuzzy matching |
| `src/utils/escapeHtml.ts` | 100% | 100% | Full coverage |
| `src/jsx-runtime.ts` | 92% | 89% | Elements, attributes, fragments, raw() |
| `src/ai/batch-planner.ts` | 94% | 100% | All batch planning scenarios |
| `src/lock.ts` | 69% | 87% | Lock lifecycle + stale cleanup |

**Not yet covered** (low priority — external API wrappers and orchestration):
- `src/ai/client.ts`, `src/ai/config.ts`, `src/ai/analyze-*.ts` — AI API clients and orchestration (require mocked HTTP responses)
- `src/cli.ts`, `src/server.ts` — Entry points (E2E territory)
- `src/export/generate.ts` — Markdown export
- `src/db/connection.ts` — PGLite setup (tested indirectly via all DB tests)
- `src/routes/ai-api.ts` — AI API routes (depend on AI client mocks)

## Test Tiers

### Tier 1 — Run on every change (fast, < 30s)
- Unit tests for parsers, utilities, JSX runtime, escaping
- Unit tests for database query logic (in-memory PGLite)
- Unit tests for AI batch planning and token estimation

### Tier 2 — Run before releases (moderate, < 2 min)
- Integration tests for API routes
- Integration tests for review lifecycle
- Integration tests for AI analysis with mocked responses
- Database migration tests

### Tier 3 — Run on CI or manually (slow, < 10 min)
- E2E tests with real git repos
- Full CLI startup and server tests
- Multi-instance / lock file tests

## Mocking Strategy

| Dependency | Approach |
|------------|----------|
| Git commands (`execSync`) | Fixture diff strings for unit tests; real temp repos for integration tests |
| PGLite | In-memory instances with fresh schema per suite |
| AI APIs (fetch) | Mock HTTP responses with fixture JSON |
| OS keychain | Mock `execSync` calls to `security`, `secret-tool`, PowerShell |
| File system | Real temp directories with cleanup |
| Browser launch | Mock/stub (never actually open a browser) |
| Tauri IPC | Skip in automated tests; test the Node.js side only |
