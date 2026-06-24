---
name: analyze-code-quality
description: Run all tests and linters, check for anti-patterns, generate a quality report
allowed-tools: Read, Grep, Glob, Bash, Agent
---

Analyze the overall quality of the source code by running all available checks and looking for known anti-patterns. Generate a comprehensive quality report.

## Process

### 1. Run automated checks

Run these commands and capture the results:

```bash
# Unit tests with coverage
npm test 2>&1

# Linter
npm run lint 2>&1

# TypeScript type checking
npx tsc --noEmit 2>&1

# E2E tests (if server not already running)
npm run test:e2e 2>&1
```

### 2. Analyze test coverage

Read the coverage output from step 1. Identify:
- Files with <50% line coverage (high risk)
- Files with 0% coverage (untested)
- Areas where unit tests exist but E2E tests don't (or vice versa)

### 3. Check for documented anti-patterns

Read `CLAUDE.md` and the requirements docs (`docs/*.md`) for documented conventions and anti-patterns. Then scan the codebase for violations:

- **`document.createElement()` usage** — Should use `toElement()` with JSX instead (per CLAUDE.md)
- **Manual HTML string concatenation** — Should use JSX/SafeHtml runtime (per CLAUDE.md)
- **Inlined CSS/JS in layout** — Client CSS and JS should be built separately and served as static files
- **Missing `.js` extension in imports** — ESM requires `.js` extensions
- **ORM or query builder usage** — Should use raw SQL via PGLite
- **`body: JSON.stringify(...)` in api() calls** — The `api()` helper auto-serializes; passing pre-stringified body causes double-encoding
- **React/ReactDOM imports** — The project uses a custom JSX runtime, not React
- **Excessive file length** — Files over 300 lines with multiple exports should be split (per code organization conventions)

### 4. Generate the report

Present findings in this structure:

#### Automated Check Results
- Test results: X passed, Y failed, Z skipped
- Lint: X errors, Y warnings
- TypeScript: X errors
- E2E: X passed, Y failed

#### Coverage Gaps
- Files below 50% coverage (table: file, line%, branch%)
- Missing E2E coverage for features that have unit tests

#### Anti-Pattern Violations
For each violation found:
- File path and line number
- Which convention is violated
- Suggested fix

#### Quality Metrics Summary
- Overall test pass rate
- Overall line coverage %
- Lint error count
- Anti-pattern violation count
- Overall assessment (good / needs attention / critical)

Present the report directly to the user. Be concise — group similar issues rather than listing every instance.
