# 1. Review Workflow

Requirements for the core review lifecycle — creating, conducting, resuming, and completing code reviews.

## Functional Requirements

### 1.1 Review Creation

- **New session** — The system shall create a new review session when launched from within a git repository.
- **Review modes** — The system shall support the following review modes:
  - `uncommitted` (default) — all uncommitted changes (staged + unstaged + untracked)
  - `staged` — only staged changes
  - `unstaged` — only unstaged changes
  - `commit <sha>` — changes from a specific commit
  - `range <from>..<to>` — changes between two refs
  - `branch <name>` — changes on the current branch vs the named branch
  - `files <patterns>` — specific files matching comma-separated glob patterns
  - `all` — the entire codebase (all tracked files)
- **Empty diff detection** — The system shall detect and report when no changes are found for the selected mode.
- **HEAD SHA capture** — The system shall record the HEAD commit SHA at the time of review creation.
- **Repository identification** — The system shall capture the repository name and root path for each review.

### 1.2 Review Resumption

- **Same-HEAD reuse** — When re-launched with the same mode and HEAD commit, the system shall reuse the existing in-progress review and update its diffs to reflect current file contents.
- **Cross-HEAD resume** — When re-launched with `--resume` and a different HEAD commit, the system shall reopen the most recent in-progress review as-is.
- **No in-progress fallback** — When `--resume` is used but no in-progress review exists, the system shall start a new review.
- **Annotation migration** — Annotations from a resumed review shall be migrated to their new line positions when diffs are updated (see doc 5, section 5.5).

### 1.3 Review Completion

- **Complete button** — The user shall be able to mark a review as completed via the "Complete Review" button.
- **Export generation** — On completion, the system shall generate a structured markdown export (see doc 6).
- **Gitignore prompt** — On completion, the system shall prompt the user to add `.glassbox/` to `.gitignore` if it is not already ignored.
- **Prompt cooldown** — The gitignore prompt shall be dismissable, with a 30-day cooldown before re-prompting.
- **Reopenable** — A completed review shall be reopenable.

### 1.4 Review History

- **Browsable history** — The system shall maintain a browsable history of all reviews for the current repository.
- **View past reviews** — Users shall be able to view past reviews (read-only or reopened).
- **Delete individual** — Users shall be able to delete individual past reviews.
- **Bulk delete** — Users shall be able to bulk-delete all completed reviews.

## Non-Functional Requirements

### 1.5 Instance Management

- **Single instance** — Only one instance of the application shall run at a time per user (enforced via PID-based lock file in `~/.glassbox/`).
- **Stale lock cleanup** — Stale lock files (from crashed processes) shall be detected and removed automatically.
- **Demo mode bypass** — Demo mode shall bypass instance locking to allow multiple simultaneous demos.

### 1.6 Startup

- **Fast readiness** — The system shall start an HTTP server and be ready to serve within a few seconds of launch. (See also doc 2, CLI and Server.)
