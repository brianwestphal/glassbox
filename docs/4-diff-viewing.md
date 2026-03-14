# 4. Diff Viewing

Requirements for displaying file diffs and navigating changes.

## Functional Requirements

### 4.1 Diff Display

- **Split mode** — The system shall render diffs in split mode (side-by-side old/new columns) by default.
- **Unified mode** — The system shall support unified mode (single-column traditional diff format).
- **Added/deleted override** — Added and deleted files shall always render in unified mode regardless of the selected diff mode.
- **Line numbers** — Each diff line shall display its line number (old-side and/or new-side as applicable).
- **Visual distinction** — Lines shall be visually distinguished by type: added (green), removed (red), context (neutral).

### 4.2 File Status

- **Status badge** — Files shall display a status badge indicating their change type: added, modified, deleted, or renamed.
- **Reviewed toggle** — Users shall be able to mark individual files as "reviewed" or "pending."
- **Binary indicator** — Binary files shall be identified and displayed with a "Binary file" indicator, not rendered as text diffs.

### 4.3 Line Wrapping and Display

- **Wrap toggle** — The system shall provide a toggle to enable/disable line wrapping for long lines.
- **Syntax highlighting** — Syntax highlighting shall be applied based on auto-detected file language.
- **Manual language selection** — Users shall be able to manually select a language for syntax highlighting.

### 4.4 Context Expansion

- **Expand beyond hunks** — Users shall be able to expand context beyond the default hunk boundaries to see surrounding lines from the working directory file.
- **Live file reads** — Context expansion shall fetch lines from the current file on disk, not from the git diff.

### 4.5 Code Outline

- **Symbol parsing** — The system shall parse and display a symbol outline (functions, classes, methods) for the currently viewed file.
- **Click to navigate** — Users shall be able to click outline entries to navigate to the corresponding line in the diff.

## Non-Functional Requirements

### 4.6 Rendering Performance

- **Large file handling** — Diff rendering shall handle files of typical production size (thousands of lines) without noticeable lag.
- **Scroll sync** — Split mode shall synchronize horizontal scroll position between old and new columns.

### 4.7 Binary Detection

- **Detection method** — Binary files shall be detected via git's binary indicator and by scanning the first 8KB for null bytes.
