# 23. Image Feedback

Requirements for giving textual feedback on images in the diff viewer — both
general comments about an image and comments anchored to rectangular regions
the reviewer draws on the image. This complements the line-anchored annotations
of doc 5, which only apply to text diffs and cannot attach to a pixel location.

The first iteration established the data model, the API, and a first-attempt UI.
A second pass added category selection, per-side scoping, hover-linking, and
geometry editing (move/resize); those are folded into the requirements below
(see §23.10) rather than split into separate documents, since they are all part
of the same image-feedback surface.

## Functional Requirements

### 23.1 General Image Comments

- **Composer** — When viewing an image diff (or the rendered view of an SVG,
  doc 4 §4.3.1), the system shall provide a text composer for adding a general
  comment about the image, not tied to any location.
- **List** — General comments shall be listed beneath the composer, each with
  edit and delete controls.
- **Persistence** — General comments shall persist across sessions and reload
  with the file.

### 23.2 Region Comments

- **Draw a region** — The reviewer shall be able to enter a "draw region" mode
  and drag a rectangle directly on the image to mark an area of interest.
- **Anchor a comment** — Each drawn region shall accept a text comment. A region
  is only persisted once it has a comment; a region drawn and then canceled
  (or left empty) is discarded.
- **Both sides** — A region is stored in normalized coordinates and is shown
  over every image comparison mode (difference, slice, single image). Because
  the A and B sides occupy the same coordinate space in those modes, a region
  marks the same place on both sides.
- **Numbering** — Regions shall be numbered, and the same number shall appear on
  the region's box over the image and in the region list.
- **Edit / delete** — Each region's comment shall be editable, and the region
  shall be deletable.

### 23.3 Coordinate Model

- Regions shall be stored as normalized `{x, y, w, h}` fractions in `[0, 1]` of
  the image's natural dimensions, so a region remains correctly placed at any
  display size or zoom level and on either side of the comparison.
- A region drawn smaller than a minimum size (a stray click rather than a drag)
  shall be discarded rather than created.

### 23.4 Data Model

Image feedback reuses the `annotations` table (doc 9) rather than introducing a
new table:

- An **image-level annotation** is identified by `line_number = 0` (line
  annotations use the real 1-based line number).
- The `region_data` column holds the JSON-encoded `{x, y, w, h}` region for a
  region comment, or `NULL` for a general image comment.
- Image-level annotations carry the same `category` as line annotations
  (default `note`, reviewer-selectable — see §23.10) and count toward the file's
  annotation badge.
- A region's optional per-side scope (§23.10) is stored inside `region_data` as
  an optional `side` field (`old` = A-only, `new` = B-only; absent = both), so no
  new column is needed. The annotation's own `side` column mirrors this for
  consistency but `region_data.side` is the source of truth for a region.

### 23.5 API

- `POST /annotations` shall accept `lineNumber: 0` and an optional `region`
  (`{x, y, w, h}`, plus an optional `side`, validated to `[0, 1]`) to create an
  image-level annotation.
- The existing `PATCH /annotations/:id` and `DELETE /annotations/:id` endpoints
  shall be used to edit (content + category) and delete image-level annotations.
- `PATCH /annotations/:id/region` shall rewrite a region annotation's geometry
  and/or per-side scope (used by move/resize and the side toggle — §23.10).
- Image-level annotations are returned by the existing
  `GET /annotations/all` and are loaded client-side for the current file.

### 23.6 Export

- The markdown export (doc 6) shall render image-level annotations distinctly:
  - a region comment as `**Image region (x%, y%, w%×h%)** [category]: …`
  - a region scoped to one side adds an `, A image only` / `, B image only`
    qualifier inside the parentheses
  - a general image comment as `**Image comment** [category]: …`
- The reviewer-selected `category` flows into the export's category summary and
  `remember` handling like any other annotation.
- `remember`-tagged image annotations shall be listed with an `(image)` anchor
  rather than a line number.

### 23.7 UI Placement (first attempt)

- The feedback UI is a panel docked at the bottom of the image-diff area, below
  the comparison canvas and above the bottom toolbar. It contains the
  "draw region" toggle, the general-comment composer + list, and the region
  list.
- Region boxes are drawn as an overlay inside the image's zoom wrapper, so they
  pan and zoom together with the image. The overlay ignores pointer events
  except while in draw mode, so zoom/pan remains unobstructed.

## Non-Functional Requirements

### 23.8 Draw vs. Pan

- Entering draw mode shall not interfere with the existing zoom/pan controls:
  while drawing, the region overlay captures the drag so the pan handler does
  not also fire; outside draw mode, the overlay is transparent to pointer
  events.

### 23.9 Draw While Zoomed / Panned

- Drawing a region while the image is zoomed and/or panned shall store
  coordinates that match the on-screen rectangle, because the draw math converts
  pointer positions against the region overlay's live (transformed) bounding
  rect. The rendered box shall land exactly where the reviewer dragged, at any
  zoom/pan, with no drift.

## Region Editing & Interaction

### 23.10 Editing an Existing Region

These extend the first-attempt region model with richer editing. They share the
`region_data` storage and the `PATCH /annotations/:id/region` endpoint above.

- **Category selection** — Every image comment and region shall expose a
  category badge that opens the shared annotation category picker (doc 5). The
  composer badges set the category for the next comment/region; a saved item's
  badge reclassifies it in place. The default remains `note`.
- **Per-side scope** — A region shall be scopeable to the A (old) image only,
  the B (new) image only, or both (the default). The scope is shown as a
  clickable `A+B` / `A` / `B` badge on the region's list row and labels its box
  on the image; A-only and B-only boxes are tinted differently. Because the
  difference and slice modes overlay both images in one coordinate space, the
  scope is a semantic label and export qualifier (e.g. "this artifact only
  exists in the new image"), not a spatial filter.
- **Hover-link** — Hovering a region's list row shall highlight its box on the
  image, and hovering a box shall highlight its list row, so the reviewer can
  tell which numbered region a comment refers to.
- **Move / resize** — A region box shall be draggable to reposition it (grab the
  interior) and resizable by its edges/corners (the opposite edge stays fixed
  and the box is held to a minimum size). The new normalized geometry persists
  via `PATCH /annotations/:id/region`. The region overlay container stays
  transparent to pointer events so empty space still pans the image; only the
  boxes themselves are interactive, and they step aside while a new region is
  being drawn.
