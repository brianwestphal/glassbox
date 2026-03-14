# 8. User Interface

Requirements for the browser-based UI and user interaction patterns.

## Functional Requirements

### 8.1 Layout

- The UI shall consist of a sidebar (file list) and a main content area (diff viewer).
- The sidebar shall be resizable via drag handle.
- The sidebar shall contain: repository name, review mode, file filter, sort mode control, file list, and action buttons (Complete Review, Review History).

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
- The settings dialog shall include:
  - AI platform selection (segmented control)
  - Model selection (dropdown per platform)
  - API key management (add, view source, remove)
  - Guided review toggle and topic selection
- When running in the Tauri desktop app, the settings dialog shall additionally include:
  - Custom app name input
  - "Check for Updates" button with status display

### 8.6 Keyboard Shortcuts

- `Cmd/Ctrl+Enter` shall save the current annotation form.
- `Escape` shall close modals and annotation forms.
- `j`/`k` shall navigate between files in the sidebar.

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

- The UI shall support both light and dark color schemes via `prefers-color-scheme` media query.
- The layout shall function at minimum window dimensions of 800x500 pixels.
