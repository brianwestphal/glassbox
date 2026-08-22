# 34. Open a Commit as a Review

A review note (doc [20](20-ai-review-notes.md)) carries the commit it was written
for, shown as a clickable origin-commit label (§20.6). This document defines the
follow-on action (GB-1144): a button on that label that **opens the note's origin
commit as its own review, jumping to the note's file + line** — "see it in the
exact context it was written for". It required a small new capability: creating a
review at runtime (reviews are otherwise only created by the CLI) and a file+line
deep-link into any review.

> **Status:** shipped (GB-1144). Consistent across the browser and the Tauri
> desktop app — a single server, in-place navigation, no second window.

## 34.1 The "Open commit" action

- **FR-34.1 — Open-commit button on the origin-commit label.** A review note that
  carries origin-commit provenance renders, beside its expandable commit label
  (§20.6), an **Open commit** button (`.ai-note-open-commit`). It carries the
  commit sha and the note's file + line as `data-open-commit` / `data-open-file`
  / `data-open-line`. Clicking it opens that commit as a review and lands on the
  note's line (FR-34.2 + FR-34.3). A note without a resolved origin renders no
  button (there is nothing to open).

## 34.2 Runtime commit-review creation

- **FR-34.2 — `POST /api/reviews/from-commit`.** A route creates — or reuses — a
  `commit:<sha>` review for the given sha in the server's repo and returns
  `{ reviewId, fileCount, created }`. It reuses the same create-and-populate body
  as the CLI's `launchReview` (`getFileDiffs({type:'commit'}) → createReview →
  addReviewFile`, plus the note-only unchanged files of §20.6), via
  `openCommitReview` in `src/review-open/commit-review.ts`. The sha is
  canonicalized to its full 40-char form (`resolveCommitSha`) before building the
  mode string, so opening the same commit via different spellings (short vs full)
  de-dupes to one review; any existing review for that commit — **in-progress or
  completed** — is reused rather than duplicated (`getLatestReviewByMode`, GB-1149;
  safe because the reviewed sha is immutable so the diff never changes between
  opens, and the user can reopen a completed one from the toolbar). An
  unresolvable sha returns **404** (`CommitNotFoundError`).
  This is the only route that creates a review — the CLI is otherwise the sole
  creator. The created review is a normal review: it appears in Review History.

## 34.3 File + line deep-link

- **FR-34.3 — `?file=&line=` deep-link.** A review page (`/` or `/review/:id`)
  honors a `?file=<repo-relative path>&line=<n>` query at load: it jumps to that
  file + line (via the existing `navigateToLocation`) instead of auto-selecting
  the first file, then cleans the query out of the URL (`history.replaceState`)
  so a later manual reload doesn't force the jump again. Parsing is a pure
  `parseDeepLink` (`src/client/diff/deepLink.ts`): no `file` param → no jump;
  `line` defaults to 1 when missing or non-positive. The `/review/:id` → `/`
  redirect (when the target is the current review) preserves the query string so
  the jump survives.

## Non-Functional Requirements

- **NFR-34.1 — Fail-soft, in-place.** Opening a commit that can't be resolved (or
  any route failure) surfaces a toast ("Could not open this commit as a review.")
  and leaves the current review untouched — no navigation, no crash. Navigation
  is in-place in the same window/webview (`window.location.assign`), so the
  behavior is identical in the browser and the Tauri desktop app; the previous
  review remains reachable via Review History and "Back to current review". No
  `window.open`/second-window path (which the Tauri webview handles poorly).

## Maintenance triggers

Update this document when the from-commit route's shape changes, when the
deep-link query contract changes, or when the open-commit button moves or changes
what it carries. Keep it in step with doc 20 §20.6 (the origin-commit label this
builds on).
