# 9. Feature / Requirement Coverage

Line and branch coverage answer *"did every line run?"*. They do **not** answer
*"is every documented behavior actually asserted?"* — and they are structurally
blind to *sequences* of behavior. A module can sit at 100% line/branch/function/
statement coverage and still ship basic bugs, because each individual operation
was tested from a clean initial state while the **transitions between internal
states** were never exercised.

Feature coverage is the orthogonal axis: walk the requirement list and ask, per
item, *is there a test that would fail if this behavior regressed?* Every gap
found becomes a new test.

## The pieces

- **The requirement index** — the requirements docs (`docs/[0-9]*.md`) enumerate
  behaviors either as explicit `**FR-N.M**` / `**NFR-N.M**` bold ids (newer docs)
  or as numbered `### N.M Title` subsections (older docs). `check-features`
  extracts a unit per behavior from both forms, so nothing needs retrofitting.
- **The coverage map** — `docs/testing/feature-coverage.json` maps each
  requirement unit to the test(s) that would fail if it regressed:

  ```json
  {
    "version": 1,
    "units": {
      "FR-27.3": {
        "stateful": true,
        "tests": ["tests/unit/git/gitignore.test.ts"],
        "transitions": ["already-present -> no-op (idempotent re-run)"]
      }
    }
  }
  ```

  A unit is **covered** when it has at least one entry in `tests`. A unit marked
  `"stateful": true` is only covered when it *also* lists the state
  `transitions` its tests exercise — a stateful unit with tests but no
  transitions is reported as a gap, because that is exactly the blind spot line
  coverage hides.

  A unit may instead carry a `"waived": "<justification>"` — reserved for
  genuine non-functional requirements that cannot be meaningfully asserted in a
  test (a performance target like "completes within seconds", an
  absence-of-telemetry property, "works with any standard git repo"). A waived
  unit is **not** a gap, but the report counts waivers separately so they stay
  visible and reviewable. Do **not** waive a testable behavior — write the test
  instead.
- **The report** — `npm run check:features` prints every unit with no map entry,
  no asserting test, or (for stateful units) no listed transitions. Advisory by
  default; `npm run check:features -- --strict` exits non-zero on any gap, for a
  pre-commit / CI gate once the map is fully populated.
- **The structural guard** — `tests/unit/conventions.test.ts` pins
  requirement-level invariants line coverage can't express (contiguous doc
  numbering, the external-dependency allow-list agreeing across `tsup.config.ts`
  / `build-sidecar.sh` / `CLAUDE.md`, no forbidden imports, unique requirement
  ids). These are the "would fail if this project rule regressed" assertions that
  no amount of line coverage would catch.

## Special attention: stateful modules

For any module with modes / phases / a state machine / a cache-with-fallback /
lifecycle transitions, the feature index must include the *transitions between
states*, not just individual operations from a clean state. When mapping such a
unit, set `"stateful": true` and enumerate the transition sequences the tests
drive — out-of-order, interleaved, repeated, empty-then-refill, and
fallback-then-recovery. `gitignore` (doc 27, `FR-27.3`–`FR-27.6`) is the worked
example in the current map: idempotent re-run, stale-line replacement,
create-when-missing, and commented-opt-out are all transitions, not single ops.

## Running the exercise

```bash
npm run check:features          # advisory report of every gap
npm run check:features -- --strict   # non-zero exit if any gap remains
```

The map ships intentionally **partial** — the tool reports every not-yet-mapped
requirement as a gap, and closing those gaps (verifying, or writing, an
asserting test per unit) is an ongoing exercise. When you add a requirement or a
test, update `feature-coverage.json` in the same pass.
