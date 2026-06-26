# 28. Single-Side Image Focus (A / B)

Glassbox compares two images (and rendered SVGs) through a set of modes in the
image toolbar: **Metadata**, **Side by Side**, **Difference**, and **Slice** (see
[4. Diff Viewing](4-diff-viewing.md) §4.3 and [24. Side-by-Side](24-image-comparison-layouts.md)).
Every comparison mode shows *both* sides at once. This document adds two modes —
**A** and **B** — that show only **one side at a time**, so a reviewer can focus
on, zoom into, and annotate a single image without the other side competing for
space.

It builds directly on the image-comparison plumbing in §4.3: A and B are new
single-image *views* over the same per-side bytes (`GET /api/image/:fileId/:side`)
and the same drawn-region feedback model in [23. Image Feedback](23-image-feedback.md).
They are structurally the single-image **Image** viewer that added/deleted files
already use, just selectable for a two-sided change and scoped to one side.

## 28.1 A and B modes

- **FR-28.1 — Modes.** For a two-sided image change (a file that has both an old
  and a new side), the image toolbar shall offer an **A** mode and a **B** mode.
  Selecting **A** shows only the old (A) image; selecting **B** shows only the
  new (B) image. Each fills the preview area as a single-image viewer.
- **FR-28.2 — Placement.** In the segmented control, the **A** and **B** segments
  shall sit **between Metadata and Side by Side**, in that order:
  Metadata · **A** · **B** · Side by Side · Difference · Slice.
- **FR-28.3 — Comparison-only.** A and B are meaningful only when both sides
  exist. For a single-side change (added → no A; deleted → no B) the A/B segments
  shall be hidden, exactly as Difference / Slice / Side by Side are hidden, and
  the file continues to use the single **Image** viewer.
- **FR-28.4 — Persistence.** The selected mode shall persist across files and
  sessions like the other image modes (the `last_image_mode` user preference,
  which now also accepts `a` / `b`). When a persisted `a`/`b` mode is reopened on
  a single-side file, it falls back to the **Image** viewer (and `image` falls
  back to Side by Side for a two-sided file), mirroring the existing fallback for
  the other comparison-only modes.

## 28.2 Zoom, pan, and feedback

- **FR-28.5 — Zoom/pan.** Each focus view shall support the same zoom/pan and the
  toolbar zoom actions (in / out / fit / actual size) as the other image modes,
  reusing the shared zoom/pan state (vector zoom for rendered SVGs,
  transform-scale for raster). The focus view sizes to its own image's natural
  dimensions.
- **FR-28.6 — Full-screen view.** The focus canvas shall offer the same hover
  **"view full screen"** button as the other single-image canvases ([doc 24](24-image-comparison-layouts.md)
  FR-24.9 / [doc 25](25-attachments.md) FR-25.7) — A opens the old image, B the
  new.
- **FR-28.7 — Drawn-region feedback.** The drawn-rectangle image feedback of
  [doc 23](23-image-feedback.md) shall work in the focus views. The A view's
  overlay is tagged `data-region-side="old"` and the B view's `data-region-side="new"`,
  so — consistent with the Side-by-Side panes (doc 24 FR-24.8) — the A view shows
  A-only and unscoped (A+B) regions, the B view shows B-only and unscoped regions.
  Region numbering and the feedback panel are unchanged.

## 28.3 Non-functional

- **NFR-28.1 — No new image transport.** A and B add no new server route; they
  read the existing `GET /api/image/:fileId/:side` bytes (the same URLs the
  Side-by-Side and overlay modes already request, so the browser serves them from
  cache — no extra fetch).
- **NFR-28.2 — View only.** The modes are client wiring plus two server-rendered
  single-image panels reusing the existing image-canvas CSS; they introduce no
  new image processing on the server and no new styles.

## Implementation pointers

- Toolbar markup (the **A** / **B** segments between Metadata and Side by Side):
  `src/components/reviewShell.tsx`.
- Server-rendered focus panels (`data-panel="a"` / `data-panel="b"`, each a single
  canvas / zoom-wrap / region overlay tagged with `data-region-side`):
  `src/components/imageDiff.tsx` (gated on `hasComparison`).
- Mode value (`a` / `b` added to `ImageModeSchema`): `src/api/ai.ts`. The
  `last_image_mode` column already stores a free-form string, so no DB migration.
- Mode resolution + toolbar visibility (`effectiveImageMode` falls back `a`/`b` →
  `image` on single-side files; `adaptImageToolbar` hides the A/B buttons when
  there is no comparison): `src/client/diff/index.tsx`. The generic
  `[data-image-mode]` click handlers (`src/client/diff/toolbar.tsx`,
  `src/client/diff/imageDiff/index.ts`) and the reactive `setupImageModeEffect`
  switch the active panel by `data-panel`, so no per-mode wiring is needed.
- Per-side region rendering: `src/client/diff/imageDiff/imageFeedback.tsx`
  (`renderOverlays` honors each overlay's `data-region-side`).

## Tests

- Unit: `tests/unit/components/imageDiff.test.ts` — the A/B panels render for a
  two-sided change and are absent for added/deleted files.
- E2E: `tests/e2e/image-diff.test.ts` ("Single-side image focus (doc 28)") —
  segment order (Metadata · A · B · Side by Side), selecting A shows only the old
  image and B only the new (others hidden, orientation sub-control hidden), and
  the selected focus mode persists across reload.
