# 32. Revealing Review Notes in the Diff Body

AI-authored review notes (the `.pr-notes/` format, authoring, storage, anchoring,
and sidebar surfacing) are defined in [20. AI-Authored Review Notes](20-ai-review-notes.md).
That document covers how a note is written and where it renders **when its line
is already shown** in the diff. This document covers one further viewing
behavior: what happens to a note whose line sits inside a **collapsed context
region**, and how such notes are revealed.

## Motivation

A diff shows changed lines plus a little surrounding context; the rest of the
file is collapsed behind hunk separators and a "Show remaining lines" tail
expander. A review note can be anchored to a line in one of those collapsed
regions — most commonly a note the generating AI wrote about a file it did **not**
change, or about a spot far from the change it did make. Before this feature such
a note existed in `.pr-notes/` but never appeared: the diff only rendered notes on
lines it already showed, and expanding a region revealed the code but not its
notes. This document makes those notes reachable.

## 32.1 Reveal on expansion

- **FR-32.1 — Notes surface when their region is expanded.** When the reviewer
  expands a collapsed region (a mid-hunk separator or the "Show remaining lines"
  tail expander), any review note anchored to a newly-revealed line shall render
  at that line, styled identically to an in-diff note (the same
  review-comment-style rows, reply threading, artifacts, and markdown as
  [§20.6](20-ai-review-notes.md)). The reveal is on demand — a note in a still-collapsed
  region stays hidden until its region is expanded (rather than the diff being
  pre-expanded around every note).
- **FR-32.2 — Both diff modes.** Revealed notes shall render correctly in **both
  split and unified** views. In split view a note row is full-width and therefore
  breaks out of the two-column layout — it is never trapped inside a single
  column.
- **FR-32.3 — Server-rendered rows.** The revealed note markup shall be produced
  by the same server-side renderer as in-diff notes, so the two are visually
  identical and the diff container's existing delegated handlers drive their
  Reply / Keep / Discard controls. The `GET /context/:fileId` endpoint returns
  the rendered rows for notes in the revealed range alongside the range's lines;
  the client splices them in.

## 32.2 Scope and staleness

- **FR-32.4 — Range-scoped.** Only notes whose (re-anchored) line falls inside
  the revealed range are returned for that expansion. A note outside the range is
  left for the expansion that reveals its own region.
- **FR-32.5 — Stale notes hidden on reveal.** A note is re-anchored against the
  revealed lines (an unchanged working-tree region, modeled as a synthetic
  all-context diff): a note that still matches follows its line and renders; a
  note whose saved snippet no longer matches the revealed code (no match nearby)
  is **not shown**. Staleness is detected by the same snippet re-anchoring used
  elsewhere ([§20.3](20-ai-review-notes.md)). *(Hiding stale notes is now the
  behavior everywhere, not just on reveal — GB-1140 removed the in-diff "outdated"
  badge + Keep/Discard so stale notes are hidden in the inline diff too;
  see [§20.3](20-ai-review-notes.md).)*

## Implementation

- `src/review-notes/context-notes.ts` — `reanchorNotesForRange` (re-anchor +
  range-scope + drop stale) and `renderContextNotes` (group by line + render rows
  with nested replies).
- `src/routes/api/context.ts` — `GET /context/:fileId` loads the file's notes
  (real `.pr-notes/` or demo), runs the above over the revealed range, and adds a
  `notes: [{ line, html }]` field to the response (`src/api/context.ts`).
- `src/components/diffView.tsx` — `renderReviewNoteRowsHtml` exposes the existing
  `ReviewNoteRows` renderer as an HTML string for the endpoint.
- `src/client/diff/hunkExpander.tsx` — splices the returned note HTML into the
  revealed lines: a sibling row after the line in unified; a partition of the
  `.split-columns` block (before-columns · full-width note · after-columns) in
  split.

## Non-Functional Requirements

- **NFR-32.1 — Reuse, not duplication.** The client must not re-implement the
  note UI; revealed notes reuse the server `ReviewNoteRows` markup and the
  existing diff-container event delegation.

## Maintenance triggers

Update this document when the context-expansion reveal path, the `/context`
response shape for notes, or the reveal-path staleness rule changes. Sidebar
surfacing of note-bearing files (the icon, unchanged-file surfacing, `.pr-notes`
folder collapse) lives in [§20.6](20-ai-review-notes.md), not here.
