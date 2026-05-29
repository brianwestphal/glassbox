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

For binary image files (PNG, JPEG, GIF, WebP), the system shall provide three comparison modes:

- **Metadata comparison** — Extract metadata (format, dimensions, file size, color space, channels, bit depth, alpha, density) from both old and new versions and display as a text diff. Changed properties are highlighted as additions/removals. Metadata is parsed from image headers (PNG IHDR, JPEG SOF/JFIF, GIF header, WebP VP8/VP8L/VP8X) with no native dependencies.
- **Difference mode** — Overlay the new (B) image on top of the old (A) image using CSS `mix-blend-mode: difference`. Identical pixels appear black; changed pixels light up. Images are centered in the container.
- **Slice mode** — Overlay images center-to-center with a draggable cutting line. Two handles on the container edges define the line (supports any angle — vertical, horizontal, diagonal). The new (B) image is clipped by the line, showing old (A) on one side and new (B) on the other. The image canvas fills the area between the diff header and the bottom toolbar via flexbox (not a viewport-height guess); both handles are pinned just inside the canvas edges so neither is clipped by the canvas's `overflow: hidden` nor hidden under the toolbar — see `sliceGeometry.ts` (`edgeHandleTransform`) and the flex sizing in `_image-diff.scss` (GB-823 — the bottom handle was previously unreachable because the canvas overshot under the toolbar).

For newly added or deleted images (no A or B side), the toolbar shows "Metadata / Image" instead of the full comparison set. Metadata displays single-side properties (no diff). Image mode shows the file in a zoom/pan-enabled viewer.

### 4.3.1 SVG Dual Mode

SVG files support both code and rendered viewing via a "Code | Rendered" toggle in the bottom toolbar:

- **Code mode** (default) — Shows the SVG as a normal text diff with split/unified, wrap, ignore whitespace, and syntax highlighting controls. Annotations are supported.
- **Rendered mode** — Rasterizes the SVG to PNG using `@resvg/resvg-wasm` (WASM, no native bindings) and shows the same image comparison modes as binary images (metadata, difference, slice). Base size is determined from `width`/`height`/`viewBox` attributes (default 300x150 per HTML spec), scaled to 10x with a maximum of **4000px** in the largest dimension. (The cap used to be 8000px; GB-838 lowered it because a single text-heavy 8000-px-wide render took 10–28s, exceeding the 15s per-job worker timeout and breaking the second concurrent rasterize call — see `MAX_RENDER_DIM` in `src/git/svg-rasterize-render.ts` for the full rationale.)

The user's Code/Rendered choice is remembered across file selections.

**NFR — non-blocking rasterization:** `resvg.render()` is synchronous CPU-bound WASM work that can take hundreds of milliseconds (seconds for large/animated SVGs). It runs in a dedicated worker thread so it never blocks the HTTP server's event loop — other requests (file switches, annotations, the other image side) stay responsive while a render is in flight. A render that exceeds a 15-second timeout is treated as pathological (e.g. an oversized animated SVG resvg can't handle): the worker is terminated, that render fails fast with a 500 rather than spinning indefinitely, and any renders queued behind it are retried on a fresh worker. If a worker thread cannot be started at all, rasterization degrades gracefully to in-process rendering. See `src/git/svg-rasterize.ts` (worker manager), `svg-rasterize-worker.ts` (worker entry), and `svg-rasterize-render.ts` (shared render core).

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

- **Detection method** — Binary files shall be detected via git's binary indicator and by scanning the first 8KB for null bytes.
