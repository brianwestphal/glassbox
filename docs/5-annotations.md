# 5. Annotations

Requirements for creating, managing, and categorizing line-level annotations.

## Functional Requirements

### 5.1 Annotation Creation

- **Click to annotate** — Users shall be able to click any diff line to open an annotation form.
- **Annotation content** — Each annotation shall consist of:
  - Free-text content (the comment)
  - A category (from a fixed set)
  - The target line number
  - The target side (old or new)
- **Immediate save** — Annotations shall be saved immediately on form submission.

### 5.2 Annotation Categories

The system shall support seven annotation categories, each with specific semantics for AI tool consumption:

- **bug** — A code defect that needs fixing.
- **fix** — A specific fix that should be applied.
- **style** — A stylistic preference to apply to the indicated lines and similar patterns.
- **pattern-follow** — A good pattern to continue using in new code.
- **pattern-avoid** — An anti-pattern that should be refactored and avoided.
- **note** — Informational context for the AI to consider (may not require code changes).
- **remember** — A rule or preference to persist to the AI's long-term configuration (e.g., CLAUDE.md, .cursorrules).

### 5.3 Annotation Editing

- **Edit content** — Users shall be able to edit annotation content after creation (double-click or edit button).
- **Change category** — Users shall be able to change an annotation's category by clicking its category badge.
- **Delete** — Users shall be able to delete individual annotations.

### 5.4 Annotation Drag and Drop

- **Drag to move** — Users shall be able to drag annotations to a different line or side within the same file.
- **Visual feedback** — Drag targets shall provide visual feedback (highlight) during drag operations.

### 5.5 Stale Annotation Handling

- **Fuzzy migration** — When diffs are updated (e.g., on review resumption), the system shall attempt to migrate annotations to their new line positions using fuzzy matching.
- **Match radius** — Fuzzy matching shall check line content within a 10-line radius of the original position.
- **Stale marking** — Annotations that cannot be matched shall be marked as "stale" with a visual indicator (red strikethrough).
- **Individual keep** — Users shall be able to individually mark a stale annotation as "current" (keep it).
- **Batch delete** — Users shall be able to batch-delete all stale annotations for a review.
- **Batch keep** — Users shall be able to batch-keep all stale annotations for a review.

### 5.6 Annotation Display

- **Inline rendering** — Annotations shall be rendered inline, directly below their target diff line.
- **Display elements** — Each annotation shall display its category badge, content, and action controls (edit, delete, drag handle).
- **Sidebar counts** — The sidebar shall show annotation counts per file.

## Non-Functional Requirements

### 5.7 Persistence

- **Immediate persistence** — All annotations shall be persisted to the database immediately on creation or modification.
- **Survive restarts** — Annotations shall survive application restarts.
