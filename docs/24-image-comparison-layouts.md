# 24. Side-by-Side Image Comparison

Glassbox compares two images (and rendered SVGs) through a set of modes in the
image toolbar. Before this document those were **Metadata**, **Difference**, and
**Slice** (see [4. Diff Viewing](4-diff-viewing.md) §4.3). This document adds a
**Side by Side** mode that shows the old (A) and new (B) images next to each
other, with a sub-option to switch between a left/right and an over/under layout.

It builds directly on the image-comparison plumbing in §4.3 and the image
feedback system in [23. Image Feedback](23-image-feedback.md) — side-by-side is a
new *layout* over the same per-side image bytes (`GET /api/image/:fileId/:side`)
and the same drawn-region feedback model.

## 24.1 Side by Side mode

- **FR-24.1 — Mode.** For a two-sided image change (a file that has both an old
  and a new side), the image toolbar shall offer a **Side by Side** mode
  alongside Metadata / Difference / Slice. It renders the old image and the new
  image in two panes, each labeled (Old (A) / New (B)).
- **FR-24.2 — Default.** Side by Side shall be the **default** selected mode when
  a two-sided image (or rendered SVG) change is opened — the most direct
  "show me both images" starting point. Single-side files (added or deleted, only
  one image) have no second pane and continue to use the single **Image** viewer;
  the persisted mode falls back to Image for them and back to Side by Side for a
  two-sided file.
- **FR-24.3 — Independent natural sizes.** Each pane shall size to *its own*
  image's natural dimensions, so an old and new image with different sizes are
  each shown fit-to-pane without distortion (not stretched to a shared aspect
  ratio).

## 24.2 Orientation sub-option

- **FR-24.4 — Single control, not two buttons.** Side by Side shall not be split
  into two separate top-level modes. Instead, while Side by Side is active, a
  secondary **orientation** control appears with two choices:
  - **Left / Right** (default) — panes placed horizontally, A on the left.
  - **Over / Under** — panes stacked vertically, A on top.
- **FR-24.5 — Visibility.** The orientation sub-control shall be shown only while
  Side by Side is the active mode and hidden for every other mode.
- **FR-24.6 — Persistence.** The chosen orientation shall persist across files
  and sessions (stored as the `image_sxs_orientation` user preference,
  `left-right` | `over-under`), the same way the last image mode persists.

## 24.3 Zoom, pan, and feedback

- **FR-24.7 — Synced zoom/pan.** Zooming or panning shall be **synchronized**
  across the two panes — zooming into a spot shows the same region on A and B —
  so aligned regions can be compared at a pixel level. This reuses the shared
  zoom/pan state already used by the difference and slice canvases (vector zoom
  for rendered SVGs, transform-scale for raster images).
- **FR-24.8 — Drawn-region feedback.** The drawn-rectangle image feedback of
  [doc 23](23-image-feedback.md) shall work in Side by Side: a region can be
  drawn on either pane, is stored in the same normalized `{x,y,w,h}` model, and
  renders over the panes. A region scoped to one side (A-only / B-only, doc 23
  §23.10) shall render only on the matching pane; an unscoped (A+B) region renders
  on both. General (non-anchored) image comments are unchanged.

## 24.4 Non-functional

- **NFR-24.1 — No new image transport.** Side by Side adds no new server route;
  both panes read the existing `GET /api/image/:fileId/:side` bytes.
- **NFR-24.2 — Layout only.** The mode is a CSS layout (`data-sxs-orientation`
  on the panel flips flex flow row↔column) plus client wiring; it introduces no
  image processing on the server.

## Implementation pointers

- Toolbar markup (mode button + orientation sub-control): `src/components/reviewShell.tsx`.
- Server-rendered panel (two panes, each its own canvas / zoom-wrap / region
  overlay tagged with `data-region-side`): `src/components/imageDiff.tsx`.
- Mode + orientation UI application (`effectiveImageMode` / `applyImageMode` /
  `applyImageOrientation`, the `adaptImageToolbar` + reactive `setupImageModeEffect`):
  `src/client/diff/index.tsx`.
- Per-pane sizing, synced zoom across the two canvases, and the orientation
  control handler: `src/client/diff/imageDiff/index.ts`.
- Per-side region rendering: `src/client/diff/imageDiff/imageFeedback.tsx`
  (`renderOverlays` honors each overlay's `data-region-side`).
- Persistence: `image_sxs_orientation` flows through `SaveAIPreferencesReq` /
  `UserPreferencesShape` (`src/api/ai.ts`), the `user_preferences` column
  (`src/db/connection.ts`, `src/db/ai-queries.ts`, `src/db/schemas.ts`), and the
  client store (`src/client/stores/index.ts`, seeded in `src/client/app.tsx`).

## Tests

- E2E: `tests/e2e/image-diff.test.ts` ("Side-by-side image comparison (doc 24)")
  — default mode + both panes, orientation sub-control visibility, over-under
  flip + persistence, and drawing a region on the B pane.
