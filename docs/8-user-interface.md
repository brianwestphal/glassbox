# 8. User Interface

Requirements for the browser-based UI and user interaction patterns.

## Functional Requirements

### 8.1 Layout

- The UI shall consist of a sidebar (file list) and a main content area (diff viewer).
- The sidebar shall be resizable via drag handle.
- The sidebar shall contain: repository name, review mode, file filter, sort mode control, file list, and action buttons (Complete Review, Review History).
- The diff header shall include a "Reveal in Finder" button that opens the file's parent directory in the OS file manager.

### 8.2 File Navigation

- Files shall be displayed in a collapsible folder tree by default.
- Users shall be able to filter files by typing in the file filter input.
- Keyboard navigation shall be supported: `j`/`k` to move between files.
- Clicking a file shall load its diff in the main content area.
- The sidebar shall display annotation count badges per file.
- The sidebar shall display stale annotation count indicators per file.

### 8.3 Sort Modes

- The sidebar shall support three sort modes via a segmented control:
  - Folder — default alphabetical tree view
  - Risk — sorted by AI risk score (highest first) with score badges
  - Narrative — sorted by AI reading order with position numbers
- Switching to an AI sort mode without a configured API key shall prompt the settings dialog.

### 8.4 Progress Tracking

- A progress bar shall show the proportion of files marked as "reviewed."
- A summary shall display "X of Y files reviewed, Z annotations."

### 8.5 Settings Dialog

- A settings dialog shall be accessible via a gear icon in the sidebar header.
- The dialog shall be closeable at any time via the close button, clicking outside, or pressing Escape.
- All settings shall save automatically when changed (no Save/Cancel buttons).
- The settings dialog shall use a tabbed interface with icon-and-label tabs:
  - **General** — Theme selection, app name (Tauri desktop app only)
  - **Profile** — Experience level and language familiarity (for AI-tailored explanations)
  - **Experimental** — AI configuration and guided review toggle
  - **Updates** — Software update checks (Tauri desktop app only; tab hidden in browser)
- The General tab shall include:
  - Theme selection dropdown and "Manage Themes" button (see `15-themes.md`)
- When running in the Tauri desktop app, the General tab shall additionally include:
  - Custom app name input (auto-saved on change, debounced)
- The Profile tab shall include:
  - "I'm new to..." topic tags: Programming, This codebase
  - "I'm new to these languages" language tags with "More languages..." toggle
  - Topic changes saved immediately / debounced for rapid changes
- The Experimental tab shall include:
  - AI platform selection (segmented control, saved immediately on switch)
  - Model selection (dropdown per platform, saved immediately on change)
  - API key management (add with inline "Save Key" button, view source, remove)
  - Guided review toggle (saved immediately)
- When running in the Tauri desktop app, the Updates tab shall include:
  - "Check for Updates" button with status display

### 8.6 Keyboard Shortcuts

- `Cmd/Ctrl+Enter` shall save the current annotation form.
- `Escape` shall close modals and annotation forms.
- `j`/`k` shall navigate between files in the sidebar.
- `Cmd/Ctrl+F` shall open the find-in-diff bar (see FR-4.7 in `4-diff-viewing.md`).
- `Cmd+Click` (macOS) / `Ctrl+Click` (Windows/Linux) on a symbol in the diff shall navigate to its definition — same file (scrolls) or different file in the review (switches file and scrolls). Uses the existing regex-based outline parser to build a cross-file symbol index.

### 8.7 Completion Modal

- Clicking "Complete Review" shall show a confirmation modal.
- After completion, the modal shall offer to add `.glassbox/` to `.gitignore` (if not already ignored).

## Non-Functional Requirements

### 8.8 Rendering

- Pages shall be server-rendered HTML with client-side JavaScript for interactivity.
- The custom JSX runtime (SafeHtml) shall be used for all HTML generation, both server-side and client-side.
- Client-side DOM elements shall be created via `toElement()`, never `document.createElement()`.
- All string content shall be auto-escaped to prevent XSS. Pre-escaped HTML shall use `raw()`.

### 8.9 Responsiveness

- The UI shall support light and dark color schemes via the theme system (see `15-themes.md`).
- The layout shall function at minimum window dimensions of 800x500 pixels.
