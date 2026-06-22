# 23. Image Feedback

Requirements for giving textual feedback on images in the diff viewer — both
general comments about an image and comments anchored to rectangular regions
the reviewer draws on the image. This complements the line-anchored annotations
of doc 5, which only apply to text diffs and cannot attach to a pixel location.

This is the first iteration. It establishes the data model, the API, and a
first-attempt UI; geometry editing (move/resize) and richer interactions are
tracked as follow-ups (see §23.9).

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
  (default `note`) and count toward the file's annotation badge.

### 23.5 API

- `POST /annotations` shall accept `lineNumber: 0` and an optional `region`
  (`{x, y, w, h}` validated to `[0, 1]`) to create an image-level annotation.
- The existing `PATCH /annotations/:id` and `DELETE /annotations/:id` endpoints
  shall be used to edit and delete image-level annotations.
- Image-level annotations are returned by the existing
  `GET /annotations/all` and are loaded client-side for the current file.

### 23.6 Export

- The markdown export (doc 6) shall render image-level annotations distinctly:
  - a region comment as `**Image region (x%, y%, w%×h%)** [category]: …`
  - a general image comment as `**Image comment** [category]: …`
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

### 23.9 Follow-ups (not in this iteration)

The following are intentionally deferred and tracked as separate tickets:

- **Move / resize** an existing region (drag the box or its edges).
- **Hover-link** between a region list item and its box on the image.
- **Category selection** for image feedback (currently fixed to `note`).
- **Per-side regions** — regions that apply to only the A or only the B side
  (the current model always shows a region on both).
- Drawing while zoomed/panned has not been exhaustively validated; the first
  attempt targets the unzoomed canvas.
