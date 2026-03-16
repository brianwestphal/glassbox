# 6. Export

Requirements for generating structured output from reviews.

## Functional Requirements

### 6.1 Export Generation

- **Output path** — The system shall generate a markdown file at `<repo>/.glassbox/latest-review.md`.
- **Archived copy** — An archived copy shall also be written to `<repo>/.glassbox/review-{reviewId}.md`.
- **Overwrite behavior** — The `latest-review.md` file shall be overwritten on each export (always reflects the most recent state).
- **Continuous auto-export** — The system shall automatically regenerate `latest-review.md` when annotations are created, modified, moved, or deleted, debounced with a 2-second delay. This allows AI tools to read the latest feedback without requiring explicit review completion.
- **Completion export** — On explicit review completion, the export shall be generated immediately (no debounce).

### 6.2 Export Format

The exported markdown shall include:

- **Header section** — Repository name, review mode, review ID, date, files reviewed count, and total annotation count.
- **Summary table** — An annotation summary table showing counts per category.
- **Items to Remember** — A section listing all `remember`-category annotations, with a preamble instructing AI tools to persist these to their configuration.
- **File Annotations** — A section grouping annotations by file, each showing the line number, category, and content.
- **AI Instructions** — An "Instructions for AI Tools" section explaining the semantics of each annotation category and how to act on them.

### 6.3 Export Lifecycle

- **Deletion cleanup** — When a review is deleted, its corresponding export file shall also be deleted.
- **Reopen preservation** — When a review is reopened, the `latest-review.md` export shall be preserved (still reflects the last completion).

## Non-Functional Requirements

### 6.4 AI Tool Compatibility

- **Plain markdown** — The export format shall be plain markdown, parseable by any AI tool that can read files (Claude Code, Cursor, Copilot, etc.).
- **Relative paths** — File paths in the export shall be relative to the repository root.
- **Clear instructions** — The instructions section shall use clear, imperative language directing AI tools on how to interpret each category.
