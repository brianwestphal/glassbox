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
- **Annotation Summary** — An "Annotation Summary" section listing per-category counts as a markdown bulleted list (e.g. `- **bug**: 3`), ordered by descending count.
- **Items to Remember** — A section listing all `remember`-category annotations, with a preamble instructing AI tools to persist these to their configuration.
- **File Annotations** — A section grouping annotations by file, each showing the line number, category, and content.
- **AI Instructions** — An "Instructions for AI Tools" section explaining the semantics of each annotation category and how to act on them.

### 6.2a Structured JSON export (machine-readable)

Alongside the markdown, the system shall write a **structured JSON** companion so
external tools can act on a review programmatically (e.g. file one ticket per
comparison) without parsing prose. Same trigger points and lifecycle as the
markdown.

- **Output paths** — `<repo>/.glassbox/latest-review.json` (current review) and
  the archive `<repo>/.glassbox/review-{reviewId}.json`.
- **Shape** — validated by a zod schema (`ReviewExportSchema` in
  `src/api/export.ts`, the SSOT; the export is `.parse()`d before writing).
  `schemaVersion: 1`; a `review` block (`id`, `repoName`, a **clean** `mode`
  label — never the raw serialized mode string — plus the raw `modeType`, `date`,
  `isCurrent`); and `comparisons[]` grouped by review file, **only those with at
  least one annotation**. Each comparison carries `fileId`, `path`, `status`, an
  optional `groundTruth` block (doc [26](26-ground-truth-comparison.md):
  `label`, `expectedKind`, `actualPath`, `expectedPath`, `differenceScore`, and
  set grouping `setLabel`/`stepIndex`/`stepCount`), and `annotations[]` with
  `id`, `category`, `content`, `lineNumber`, optional `region` (the doc-23
  rectangle as both `normalized` fractions and, when the image's natural size is
  resolvable, denormalized `pixel` coords, plus `scope` = `old`/`new`/`both` —
  for ground-truth, `old` = expected, `new` = actual), and `attachments[]`
  (`storedPath`, `originalFilename`). Built by `buildReviewExportData`
  (`src/export/build-data.ts`, pure) from the same data as the markdown, so the
  two never drift.
- **Consumed by** the `--on-complete` hook (doc [2](2-cli-and-server.md)) and any
  external integration (see [ai-integration.md](ai-integration.md)).

### 6.3 Export Lifecycle

- **Deletion cleanup** — When a review is deleted, its corresponding export files (markdown **and** JSON) shall also be deleted.
- **Reopen preservation** — When a review is reopened, the `latest-review.md` export shall be preserved (still reflects the last completion).

## Non-Functional Requirements

### 6.4 AI Tool Compatibility

- **Plain markdown** — The export format shall be plain markdown, parseable by any AI tool that can read files (Claude Code, Cursor, Copilot, etc.).
- **Relative paths** — File paths in the export shall be relative to the repository root.
- **Clear instructions** — The instructions section shall use clear, imperative language directing AI tools on how to interpret each category.
