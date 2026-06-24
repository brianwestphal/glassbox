# 4. Diff Viewing

Requirements for displaying file diffs and navigating changes.

## Functional Requirements

### 4.1 Diff Display

- **Split mode** — The system shall render diffs in split mode (side-by-side old/new columns) by default.
- **Unified mode** — The system shall support unified mode (single-column traditional diff format).
- **Added/deleted override** — Added and deleted files shall always render in unified mode regardless of the selected diff mode.
- **Line numbers** — Each diff line shall display its line number (old-side and/or new-side as applicable). Line numbers are rendered via CSS pseudo-elements so they are excluded from text selection and clipboard copies.
- **Visual distinction** — Lines shall be visually distinguished by type: added (green), removed (red), context (neutral).
- **Text selection** — Users shall be able to select and copy code text without line numbers being included. In split mode, text selection shall be isolated to one column at a time — starting a selection in the left column prevents selecting text in the right column, and vice versa.

### 4.2 File Status

- **Status badge** — Files shall display a status badge indicating their change type: added, modified, deleted, or renamed.
- **Reviewed toggle** — Users shall be able to mark individual files as "reviewed" or "pending."
- **Binary indicator** — Non-image binary files shall be identified and displayed with a "Binary file" indicator, not rendered as text diffs.

### 4.3 Image Comparison

For binary image files (PNG, JPEG, GIF, WebP), the system shall provide these comparison modes:

- **Metadata comparison** — Extract metadata (format, dimensions, file size, color space, channels, bit depth, alpha, density) from both old and new versions and display as a text diff. Changed properties are highlighted as additions/removals. Metadata is parsed from image headers (PNG IHDR, JPEG SOF/JFIF, GIF header, WebP VP8/VP8L/VP8X) with no native dependencies.
- **Side by Side mode** — Show the old (A) and new (B) images in two panes, with a sub-option to switch between a left/right (default) and an over/under layout. This is the **default** mode for a two-sided image change. See [24. Side-by-Side Image Comparison](24-image-comparison-layouts.md) for the full requirements.
- **Difference mode** — Overlay the new (B) image on top of the old (A) image using CSS `mix-blend-mode: difference`. Identical pixels appear black; changed pixels light up. Images are centered in the container.
- **Slice mode** — Overlay images center-to-center with a draggable cutting line. Two handles on the container edges define the line (supports any angle — vertical, horizontal, diagonal). The new (B) image is clipped by the line, showing old (A) on one side and new (B) on the other. The image canvas fills the area between the diff header and the bottom toolbar via flexbox (not a viewport-height guess); both handles are pinned just inside the canvas edges so neither is clipped by the canvas's `overflow: hidden` nor hidden under the toolbar — see `sliceGeometry.ts` (`edgeHandleTransform`) and the flex sizing in `_image-diff.scss` (GB-823 — the bottom handle was previously unreachable because the canvas overshot under the toolbar).

For newly added or deleted images (no A or B side), the toolbar shows "Metadata / Image" instead of the full comparison set. Metadata displays single-side properties (no diff). Image mode shows the file in a zoom/pan-enabled viewer.

**Zoom / pan controls** (shared by raster and SVG image diffs): the toolbar's zoom buttons (in / out / fit / actual), click-and-drag to pan a zoomed image (with a `grab`/`grabbing` cursor), and macOS-native trackpad gestures (GB-942) — a **pinch zooms** (which the browser delivers as a `wheel` event with `ctrlKey`, so Ctrl/Cmd+wheel zooms too) and a **plain two-finger swipe pans** (a `wheel` event without `ctrlKey`; only acts once the image is zoomed in). The gesture split lives in the canvas `wheel` handler in `src/client/diff/imageDiff/index.ts`.

### 4.3.1 SVG Dual Mode

SVG files support both code and rendered viewing via a "Code | Rendered" toggle in the bottom toolbar:

- **Code mode** (default) — Shows the SVG as a normal text diff with split/unified, wrap, ignore whitespace, and syntax highlighting controls. Annotations are supported.
- **Rendered mode** — Renders the SVG **live in the browser** and shows the same image comparison modes as binary images (metadata, difference, slice). Each side is served from `GET /api/image/:fileId/:side` as raw `image/svg+xml` and displayed in a native `<img>`, so the browser draws the SVG at full vector fidelity and **animated SVGs animate** (CSS and SMIL animation run). The `mix-blend-mode: difference` overlay (difference mode) and the `clip-path` cut (slice mode) work on a native-SVG `<img>` exactly as they do for raster images. The rendered "actual size" target and the font-rendering caveat banner are derived server-side from the SVG source via `parseSvgDimensions` / `svgUsesExternalFonts` in `src/git/svg-meta.ts` (base size from `width`/`height`/`viewBox`, default 300×150 per HTML spec).
  - **Vector zoom (GB-941)** — Zooming a rendered SVG keeps it crisp at any zoom. Raster images zoom via a CSS `transform: scale()` (cheap, but it magnifies a fixed bitmap — correct for pixels). An SVG instead grows the zoom wrapper's **layout** size (`width`/`height` = base × zoom) and uses `translate()` only for pan, so the browser re-rasterizes the vector at full resolution at each step rather than blowing up a bitmap. The mode is selected per file in `bindImageDiff` (the `.diff-view` ancestor carries `data-is-svg`) and the zoom math branches on it in `zoom.ts` (`applyZoom` / `clampPan` / `zoomAt`) and `sliceTool.ts` (clip-path fractions). The region overlay (doc 23) is overlay-rect-based, so it tracks either model automatically. Two things make panning a zoomed SVG reliable: `flex-shrink: 0` on `.image-zoom-wrap` (so a zoomed wrapper is allowed to overflow the canvas instead of being shrunk back to fit), and a pan clamp that measures the wrapper's **real** `offsetLeft`/`offsetTop` rather than assuming the flex parent centers an overflowing child (engines differ — some pin the start). A `grab`/`grabbing` cursor signals that a zoomed image can be dragged.

The user's Code/Rendered choice is remembered across file selections.

**Why native rendering (GB-932):** Glassbox previously rasterized SVGs to PNG server-side with `@resvg/resvg-wasm` in a worker thread. That flattened animations, depended on a curated set of bundled fonts, and a single large text-heavy render could take tens of seconds (the worker carried a 15-second timeout and a 4000px cap to contain it). Serving the SVG bytes directly to a native `<img>` removes all of that: animations are preserved, text uses the browser's own font stack, and there is no CPU-bound render on the request path. It is also safe — an `<img>` with an SVG source does **not** execute embedded scripts or load external resources. The resvg rasterizer, its worker thread, and the `@resvg/resvg-wasm` dependency have been removed.

**Font caveat:** Because the browser renders SVG text with locally available fonts (external font URLs do not load inside an `<img>`), text using a non-system or web font may fall back. When an SVG contains `<text>`, `font-family`, or `@font-face`, the rendered view shows a one-line caveat that text may render differently across machines.

### 4.4 Line Wrapping and Display

- **Wrap toggle** — The system shall provide a toggle to enable/disable line wrapping for long lines.
- **Ignore whitespace toggle** — The system shall provide a toggle to hide whitespace-only changes. When enabled, the diff is regenerated from git with `-w` flag. The setting is persisted across sessions via user preferences.
- **Syntax highlighting** — Syntax highlighting shall be applied based on auto-detected file language.
- **Manual language selection** — Users shall be able to manually select a language for syntax highlighting.

**NFR — large lines do not block the UI:** A single very long line (a minified bundle, a base64 data-URI, or an SVG/illustration serialized onto one line — commonly hundreds of KB to over 1 MB) is pathological for the diff viewer. Rendering its full content puts a multi-hundred-KB text node into the DOM, and laying out + painting that one enormous line freezes the browser's main thread for seconds, locking up file switching. The freeze is worst in the desktop app's macOS WKWebView, where real compositing of a multi-million-pixel-wide line is far costlier than a headless browser's — so timing-only tests in headless Chromium do **not** reproduce it; the regression guard must assert the *mechanism* (bounded rendered content), not a timing budget. Two layers protect against this:

- **Truncated display (primary):** Server-side, any diff line longer than `MAX_DIFF_LINE_LENGTH` (`src/utils/lineTruncate.ts`, used by `DiffView` in `src/components/diffView.tsx`) renders only a bounded prefix plus a `.line-truncated` marker naming how many characters were elided. The giant content never reaches the DOM, so there is nothing huge to lay out or paint. Full line content is preserved in the stored diff (annotations key off line numbers, and export reads the stored diff), so nothing downstream is lost.
- **Skipped highlighting (secondary):** Syntax highlighting emits one nested `<span>` per token, so highlighting a long line would inject tens of thousands of elements; lines past `MAX_HIGHLIGHT_LINE_LENGTH` are left unhighlighted (`src/client/diff/highlightLimits.ts`, used in `applyHighlighting()`), and cells carrying a `.line-truncated` marker are skipped entirely so re-highlighting can't fold the marker back into the source. Highlighting such lines is visually useless anyway.

### 4.5 Context Expansion

- **Expand beyond hunks** — Users shall be able to expand context beyond the default hunk boundaries to see surrounding lines from the working directory file.
- **Live file reads** — Context expansion shall fetch lines from the current file on disk, not from the git diff.

### 4.6 Code Outline

- **Symbol parsing** — The system shall parse and display a symbol outline (functions, classes, methods) for the currently viewed file.
- **Click to navigate** — Users shall be able to click outline entries to navigate to the corresponding line in the diff.

### 4.7 Find in Diff

- **Find bar** — `Cmd/Ctrl+F` shall open a find bar within the diff view for searching the currently displayed diff content.
- **Match highlighting** — Search matches shall be highlighted in the diff.
- **Match navigation** — Users shall be able to navigate between matches using up/down arrows or `Enter`/`Shift+Enter`.
- **Dismiss** — The find bar shall be closeable via `Escape`.
- **Tauri integration** — In the Tauri desktop app, the native find command shall be intercepted and routed to the in-app find bar.

## Non-Functional Requirements

### 4.8 Rendering Performance

- **Large file handling** — Diff rendering shall handle files of typical production size (thousands of lines) without noticeable lag.
- **Scroll sync** — Split mode shall synchronize horizontal scroll position between old and new columns.

### 4.9 Binary Detection

- **Detection method** — For tracked files, binary status comes from git's own indicator (the `Binary files … differ` diff header). The first-8KB null-byte scan is **only** applied to **untracked/new** files (which have no git diff header to read); it is not a universal second check on tracked diffs. See doc 3 §3.4.
