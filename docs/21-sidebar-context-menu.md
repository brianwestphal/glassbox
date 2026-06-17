# 21. Sidebar Context Menu

Requirements for the right-click context menu on sidebar file rows.

## Functional Requirements

### 21.1 Trigger

- Right-clicking (the context-menu gesture) on a file row in the sidebar shall
  open a custom context menu anchored at the cursor.
- The menu shall apply to file rows in **all** sort modes (Folder, Risk,
  Narrative) — every row carries `data-file-id`, so a single delegated
  `contextmenu` handler covers them all.
- The browser's native context menu shall be suppressed on file rows (the custom
  menu replaces it). Right-clicking elsewhere in the sidebar (empty space, folder
  headers, the filter) shall not open the custom menu and shall leave the native
  menu untouched.

### 21.2 Menu Actions

The menu offers the following actions, in order — Reveal, Copy Path, a
separator, Mark reviewed/pending, Open in Default Editor — each with a Lucide
icon. All server-side actions are **best-effort**: failures are swallowed and
logged only under `--debug`, never surfaced to the user.

#### 21.2.1 Reveal in File Manager

- Opens the file's location in the platform's file browser, with the file
  selected where the OS supports it.
- The label is platform-appropriate (detected from the user agent):
  - **macOS** — "Reveal in Finder" (Finder, file selected via `open -R`).
  - **Windows** — "Reveal in File Explorer" (Explorer, file selected via
    `explorer /select`).
  - **Linux / other** — "Open Containing Folder" (opens the containing directory
    via `xdg-open`; there is no widely-supported "select the file" equivalent).
- Reveals via the existing `POST /api/files/:fileId/reveal` →
  `openOS(path, 'reveal')`.

#### 21.2.2 Copy Path

- Copies the file's path to the clipboard. The behavior is **modifier-aware**,
  mirroring Finder's Option toggle:
  - Default (no modifier) — copies the **absolute** path. Label: "Copy Absolute
    Path".
  - **Option / Alt** held — copies the repo-**relative** path. Label: "Copy
    Relative Path".
- The label updates live while the menu is open as Option/Alt is pressed or
  released.
- The relative path comes from the in-memory file list; the absolute path is
  resolved server-side via `GET /api/files/:fileId/path` (returns both
  `relativePath` and `absolutePath`, so direct-comparison / difftool modes
  resolve correctly).

#### 21.2.3 Mark Reviewed / Pending

- Toggles the file's reviewed/pending status, mirroring the per-file status dot.
  The label reflects the current state ("Mark as Reviewed" when pending, "Mark as
  Pending" when reviewed).
- Uses the existing `PATCH /api/files/:fileId/status`; the client store update
  drives the status dot and the reactive progress bar.

#### 21.2.4 Open in Default Editor

- Opens the file in its default GUI application — for a source file that's
  typically the user's code editor — via `POST /api/files/:fileId/open` →
  `openOS(path, 'edit')` (`open` / `start` / `xdg-open`, path passed as a
  separate argv per doc 14 FR-14.3).
- It deliberately does **not** honor `$EDITOR` / `$VISUAL`: those are commonly
  *terminal* editors (vim/nano) which, spawned detached with no controlling
  terminal, silently do nothing — so the action appeared to do nothing at all
  (GB-892). Routing through the OS default-open handler always reaches a GUI app.

### 21.3 Dismissal & Placement

- The menu shall close on any of: selecting an item, pressing `Escape`, clicking
  or right-clicking anywhere outside the menu, scrolling, or the window losing
  focus. Dismissal alone shall not trigger any action.
- The menu shall be clamped to the viewport so a right-click near the bottom or
  right edge does not open it partly off-screen.

## Non-Functional Requirements

### 21.4 Consistency & Extensibility

- The menu shall be a themeable custom HTML element driven by the theme's CSS
  custom properties (not a native menu), so it looks consistent across the
  browser and the Tauri desktop shell.
- The menu shell shall be structured to accept additional actions without
  rework (a single delegated click handler dispatches by `data-action`). Pure
  label logic lives in a DOM-free `contextMenuLabels.ts` module so it is unit
  testable in isolation.
