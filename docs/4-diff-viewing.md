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

- **Metadata comparison** — Extract metadata (format, dimensions, file size, color space, channels, bit depth, alpha, density, EXIF) from both old and new versions using `sharp` and display as a text diff. Changed properties are highlighted as additions/removals.
- **Difference mode** — Overlay the new (B) image on top of the old (A) image using CSS `mix-blend-mode: difference`. Identical pixels appear black; changed pixels light up. Images are centered in the container.
- **Slice mode** — Overlay images center-to-center with a draggable cutting line. Two handles on the container edges define the line (supports any angle — vertical, horizontal, diagonal). The new (B) image is clipped by the line, showing old (A) on one side and new (B) on the other.

For newly added or deleted images (no A or B side), only the single image is displayed without comparison modes.

SVG files are text-based and render as normal text diffs (not image comparisons).

### 4.4 Line Wrapping and Display

- **Wrap toggle** — The system shall provide a toggle to enable/disable line wrapping for long lines.
- **Ignore whitespace toggle** — The system shall provide a toggle to hide whitespace-only changes. When enabled, the diff is regenerated from git with `-w` flag. The setting is persisted across sessions via user preferences.
- **Syntax highlighting** — Syntax highlighting shall be applied based on auto-detected file language.
- **Manual language selection** — Users shall be able to manually select a language for syntax highlighting.

### 4.5 Context Expansion

- **Expand beyond hunks** — Users shall be able to expand context beyond the default hunk boundaries to see surrounding lines from the working directory file.
- **Live file reads** — Context expansion shall fetch lines from the current file on disk, not from the git diff.

### 4.6 Code Outline

- **Symbol parsing** — The system shall parse and display a symbol outline (functions, classes, methods) for the currently viewed file.
- **Click to navigate** — Users shall be able to click outline entries to navigate to the corresponding line in the diff.

## Non-Functional Requirements

### 4.6 Rendering Performance

- **Large file handling** — Diff rendering shall handle files of typical production size (thousands of lines) without noticeable lag.
- **Scroll sync** — Split mode shall synchronize horizontal scroll position between old and new columns.

### 4.7 Binary Detection

- **Detection method** — Binary files shall be detected via git's binary indicator and by scanning the first 8KB for null bytes.
