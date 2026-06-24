# 27. Automatic .gitignore Management

Glassbox writes its working data (the review database, exports, attachments,
on-complete logs, image blobs, …) into a `.glassbox/` directory in the project.
That directory should not be committed — **except** the per-project
`.glassbox/settings.json` (doc 9), which is intentional, shareable config (e.g.
the custom `appName`). At launch, Glassbox keeps the project's `.gitignore` in
the right state automatically.

This supersedes the earlier *completion-time prompt* (a modal that asked the
user to add `.glassbox/` on review completion, with a 30-day dismiss cooldown).
That prompt and its `POST /api/gitignore/add` + `/dismiss` endpoints have been
removed in favor of the automatic launch-time behavior described here.

## Functional Requirements

- **FR-27.1 — Automatic at launch.** On launch, before serving a review,
  Glassbox shall ensure the project's `.gitignore` contains the canonical block
  that ignores the *contents* of `.glassbox/` while keeping `settings.json`
  tracked:

  ```
  /.glassbox/*
  !/.glassbox/settings.json
  ```

- **FR-27.2 — Contents-glob + negation (not the bare directory).** The pattern
  shall ignore the directory's contents (`/.glassbox/*`), not the directory
  itself (`.glassbox/`). Git does not descend into a fully-ignored directory, so
  a bare `.glassbox/` would also ignore `settings.json` and the `!` re-include
  could not take effect. Ignoring the contents leaves the directory visible to
  git, so `!/.glassbox/settings.json` keeps that one file tracked.

- **FR-27.3 — Idempotent.** If the canonical block is already present, Glassbox
  shall make no change (no duplicate lines, no churn on every launch).

- **FR-27.4 — Replace stale entries.** If the `.gitignore` already contains an
  older Glassbox-style entry — any uncommented line that, after stripping a
  leading `!` and `/`, is `.glassbox` or starts with `.glassbox/` (e.g.
  `.glassbox`, `/.glassbox`, `.glassbox/`, `.glassbox/*`, a stray
  `!.glassbox/settings.json`) — Glassbox shall replace it with the canonical
  block in place of the first such line, drop any other such lines, and preserve
  every unrelated line verbatim.

- **FR-27.5 — Create when missing.** If no `.gitignore` exists, Glassbox shall
  create one containing the canonical block. If one exists without any Glassbox
  entry, the block shall be appended (separated by a blank line).

- **FR-27.6 — Explicit opt-out via a comment.** If the `.gitignore` contains a
  **commented** line matching the Glassbox pattern (e.g. `# /.glassbox/*` or
  `# .glassbox/`), the user has explicitly taken control; Glassbox shall leave
  the file completely untouched. This is the supported way to force `.glassbox/`
  to be committed (an unusual choice) — leave a commented copy of the rule in
  place and Glassbox will not re-add the active block.

- **FR-27.7 — Git-repo + default-directory scope.** The update shall apply only
  when the `.glassbox/` directory's parent is inside a git working tree, and only
  for the default `.glassbox` directory name. It is therefore skipped for demo
  mode (which uses a throwaway temp directory), for a custom `--data-dir` whose
  basename is not `.glassbox`, and for `--diff` / `--ground-truth` runs outside a
  git repository (doc 18, doc 26).

- **FR-27.8 — Notify on change.** When Glassbox actually modifies the
  `.gitignore`, it shall print a one-line notice to stdout; an unchanged file
  produces no output.

## Non-Functional Requirements

- **NFR-27.1 — Pure, testable core.** The content transformation
  (`computeGitignore`) shall be a pure function of the existing content,
  unit-tested for create / append / replace / idempotent / opt-out cases. The
  filesystem + git-repo gating lives in a thin wrapper (`ensureGlassboxGitignored`).

- **NFR-27.2 — Non-destructive.** Updating the `.gitignore` shall never remove or
  reorder lines other than stale Glassbox entries, and shall preserve the file's
  other content exactly.

## Implementation

- `src/git/gitignore.ts` — `computeGitignore(existing)` (pure) +
  `ensureGlassboxGitignored(glassboxDir)` (gated read/modify/write).
- `src/cli.ts` — calls `ensureGlassboxGitignored(dataDir)` at launch for review
  modes (after the demo early-return), logging when it changes the file.

See also: doc 9 (data storage — what lives under `.glassbox/`, and why
`settings.json` is the one tracked exception) and doc 1 (review workflow).
