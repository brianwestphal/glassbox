# 4. Review Lifecycle

Test coverage for review creation, resumption, completion, export, and annotation migration — the core user workflow that ties multiple subsystems together.

## Unit Tests

### Annotation Migration (`src/review-update.ts`)

Annotation migration runs when a review is resumed and diffs have changed. It attempts to move each annotation to the matching line in the new diff using fuzzy content matching.

- **Exact line match** — An annotation on a line whose content hasn't moved. Verify it stays at the same line number.
- **Shifted lines** — An annotation on a line that moved down by N lines due to insertions above. Verify the annotation follows the content.
- **Content match within radius** — An annotation whose target line moved within the 10-line search radius. Verify it is found and relocated.
- **Content match outside radius** — An annotation whose target line moved more than 10 lines away. Verify it is marked stale.
- **Deleted line** — An annotation on a line that no longer exists in the new diff. Verify it is marked stale.
- **Multiple candidates** — Two lines with identical content within the search radius. Verify the closest match is chosen.
- **Side detection** — Annotations on the old side vs. new side. Verify side-specific matching (old-side annotations match against removed lines, new-side against added lines).
- **Stale to current** — A previously stale annotation whose content reappears in a new diff. Verify it is unmarked as stale.
- **Batch migration** — Multiple annotations across multiple files. Verify each is processed independently and correctly.

### Export Generation (`src/export/generate.ts`)

- **Basic export structure** — A review with annotations across multiple files. Verify the markdown output contains: header, summary table, file sections, and AI instructions.
- **Category grouping** — Annotations of different categories in the summary table. Verify counts per category are accurate.
- **Remember section** — Annotations with the `remember` category appear in the "Items to Remember" section with the correct preamble.
- **No remember annotations** — A review with no `remember`-category annotations. Verify the section is omitted or empty.
- **File annotation grouping** — Annotations grouped by file path, each showing line number, category badge, and content.
- **Empty review export** — A review with no annotations. Verify the export is still valid markdown with zero counts.
- **Relative file paths** — File paths in the export should be relative to the repo root, not absolute.
- **Snapshot testing** — Use snapshot tests for the full export output to catch unintended formatting changes.

### Gitignore Logic (`src/export/generate.ts`)

- **Not in gitignore** — `.glassbox/` is not in `.gitignore`. The prompt should be shown.
- **Already in gitignore** — `.glassbox/` is already ignored. The prompt should not be shown.
- **Dismiss cooldown** — After dismissing the prompt, it should not reappear for 30 days.
- **Cooldown expiry** — After 30 days, the prompt should reappear.
- **Adding to gitignore** — Appending `.glassbox/` to `.gitignore`. Verify correct formatting (newline before entry if file doesn't end with one).
- **Missing gitignore** — No `.gitignore` file exists. Verify one is created with `.glassbox/` as the first entry.

## Integration Tests

### Full Review Lifecycle

These tests exercise the complete flow by combining database operations, git diffs, and export generation.

- **Create → annotate → complete → export** — Start a new review with real diffs, add annotations, complete the review, and verify the export file is written to `.glassbox/latest-review.md` with correct content.
- **Create → complete → reopen → annotate → complete** — Verify that reopening a review allows new annotations and produces a fresh export.
- **Create → annotate → resume (same HEAD)** — Resume a review when HEAD hasn't changed. Verify annotations are preserved and diffs are refreshed from current file contents.
- **Create → annotate → resume (different HEAD)** — Resume with `--resume` after committing changes. Verify the review reopens as-is (cross-HEAD resume).
- **Create → annotate → resume with file changes** — Modify annotated files between sessions. Verify annotation migration runs and stale annotations are correctly identified.

### Review History

- **List reviews** — Create multiple reviews (different modes, some completed). Verify the history listing shows all of them with correct metadata.
- **Delete individual review** — Delete a past review. Verify it no longer appears in history and its export file is removed.
- **Bulk delete completed** — Delete all completed reviews. Verify in-progress reviews are preserved.
- **View past review** — Load a completed review's data. Verify file list and annotations are readable.

### Export File Management

- **Latest overwrite** — Complete two reviews in succession. Verify `latest-review.md` reflects the most recent one.
- **Archived copy** — On completion, verify `review-{id}.md` is also written.
- **Deletion cleanup** — When a review is deleted, verify its archived export file is also removed.
- **Reopen preservation** — When a review is reopened, verify `latest-review.md` is not deleted (it still reflects the last completion).

## Edge Cases

- **Review with no files** — A mode that produces zero diffs (e.g., `staged` with nothing staged). Verify clean handling through the entire lifecycle.
- **Review with binary-only files** — Only binary files changed. Verify they appear in the file list but have no diff content or annotation targets.
- **Large annotation counts** — A review with 100+ annotations across many files. Verify export handles scale without issues.
- **Concurrent annotation migration** — Resuming a review while annotations are being read by another request. Verify no data corruption.
- **Stale annotation actions** — Keep, delete, batch-keep, and batch-delete operations on stale annotations. Verify correct state transitions.
