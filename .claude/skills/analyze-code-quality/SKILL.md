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
npm run typecheck 2>&1

# E2E tests (if server not already running)
npm run test:e2e 2>&1

# Smoke tests — run the BUILT dist/cli.js, so they catch ESM-bundle-only
# runtime failures the tsx-based e2e suite can't (e.g. a bundled CJS dep
# calling require()). Requires a prior `npm run build`.
npm run test:smoke 2>&1
```

### 2. Analyze test coverage — treat 100% as a floor, not a ceiling

Read the coverage output from step 1. Identify:
- Files with <50% line coverage (high risk)
- Files with 0% coverage (untested)
- Areas where unit tests exist but E2E tests don't (or vice versa)

**Then explicitly state the limit of what this number proves.** Line/branch coverage shows every *line ran* — it does **not** show that every *behavior* or every *sequence of behaviors* is *asserted*. A stateful module can sit at 100% line/branch/function/statement coverage and still ship basic bugs, because each individual operation was tested from a clean initial state while the *transitions between internal states* were never exercised. So do **not** treat a high coverage number as a stopping point: a module at 100% coverage is exactly where the behavioral / state-transition audit (step 3) earns its keep. Use the coverage report to *trigger* that audit, not to skip it.

### 3. Behavioral / state-transition audit

Line coverage is structurally blind to a whole class of bugs: a missing behavior, or a valid *sequence* of operations that was never run together. This step finds them.

**Identify the stateful modules.** Scan the source for modules that carry internal state across calls or branch on an internal mode/flag/phase. Heuristics — any module that:

- switches on an internal `mode` / `type` / `status` / `phase` / `kind` field (e.g. the review-mode branches in `src/git/diff.ts`, image-comparison modes, sort modes, the settings-dialog / completion-modal stage signals);
- is a **state machine** or has explicit lifecycle transitions (open → edit → save → close; not-started → started → completed; loading → loaded → error);
- is a **cache with a fallback path** (e.g. live model discovery falling back to the static list in `src/ai/list-models.ts`, the Apple-FM availability cache + secondary-fallback-model retry in `runAnalysisBatch`, re-anchoring of review notes);
- holds a **reactive store / signal** whose actions mutate a collection (`src/client/stores/index.ts`), or drives DOM that must survive re-renders (`data-morph-*` regions);
- accumulates across a session (the difftool per-file accumulating session, drag-and-drop reordering, navigation back/forward stack).

**For each stateful module, enumerate its states and the transitions between them, then check the tests for *transition* coverage — not just single-operation-from-clean-state.** For every transition edge that matters, ask: *is there a test that drives the module through this sequence and asserts the result?* Concretely, look for tests that exercise:

- **Out-of-order** operations (do B before A when the happy path is A→B);
- **Interleaved** operations across two entities/modes (edit annotation X while a form on Y is open; flip sort mode mid-fetch);
- **Repeated** operations (save twice, complete then reopen then complete, toggle a mode back and forth);
- **Empty-then-refill** and **refill-after-clear** (mark all reviewed then add a file; clear a cache then re-query; delete the last item then add one);
- **Fallback / error paths and recovery** (primary path fails → fallback runs → primary succeeds again).

**Flag any stateful module whose tests only cover each operation from a clean initial state.** For each flagged module, recommend an **adversarial transition-matrix test**: name the states, and list the specific out-of-order / interleaved / repeated / empty-then-refill sequences that should be added. A module at 100% line coverage with no transition tests is a *finding*, not a pass.

### 4. Check for documented anti-patterns

Read `CLAUDE.md` and the requirements docs (`docs/*.md`) for documented conventions and anti-patterns. Then scan the codebase for violations:

- **`document.createElement()` usage** — Should use `toElement()` with JSX instead (per CLAUDE.md)
- **Manual HTML string concatenation** — Should use JSX/SafeHtml runtime (per CLAUDE.md)
- **Inlined CSS/JS in layout** — Client CSS and JS should be built separately and served as static files
- **Missing `.js` extension in imports** — ESM requires `.js` extensions
- **ORM or query builder usage** — Should use raw SQL via PGLite
- **`body: JSON.stringify(...)` in api() calls** — The `api()` helper auto-serializes; passing pre-stringified body causes double-encoding
- **React/ReactDOM imports** — The project uses a custom JSX runtime, not React
- **Excessive file length** — Files over 300 lines with multiple exports should be split (per code organization conventions)

### 5. Generate the report

Present findings in this structure:

#### Automated Check Results
- Test results: X passed, Y failed, Z skipped
- Lint: X errors, Y warnings
- TypeScript: X errors
- E2E: X passed, Y failed
- Smoke: X passed, Y failed

#### Coverage Gaps
- Files below 50% coverage (table: file, line%, branch%)
- Missing E2E coverage for features that have unit tests

#### Behavioral / Transition-Coverage Gaps
A per-stateful-module table: **module → states → transition-test coverage (yes / partial / none) → recommended sequences to add**. List every stateful module found in step 3, and mark as a finding any that is well-covered by line count but has untested transitions. This section must be able to flag a module sitting at 100% line/branch coverage whose transitions are untested — that is the whole point of the audit.

#### Anti-Pattern Violations
For each violation found:
- File path and line number
- Which convention is violated
- Suggested fix

#### Quality Metrics Summary
- Overall test pass rate
- Overall line coverage % (note: a floor, not a ceiling — see the transition gaps above)
- Number of stateful modules with untested transitions
- Lint error count
- Anti-pattern violation count
- Overall assessment (good / needs attention / critical)

Present the report directly to the user. Be concise — group similar issues rather than listing every instance.
