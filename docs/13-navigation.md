# 13. Navigation

Requirements for code navigation features — go-to-definition and navigation history.

## Functional Requirements

### 13.1 Go-to-Definition

- **Cmd+Click / Ctrl+Click** — Cmd+Click (macOS) or Ctrl+Click (Windows/Linux) on a symbol name in the diff view shall navigate to its definition.
- **Symbol resolution** — The system shall search for symbol definitions using the regex-based outline parser across all files. Search order: current file first, then other files in the review, then all tracked files in the repository.
- **Same-file navigation** — If the definition is in the current file, the view shall scroll to the definition line with a brief highlight animation.
- **Cross-file navigation (review files)** — If the definition is in another file in the review, the system shall switch to that file and scroll to the definition line.
- **Cross-file navigation (repo files)** — If the definition is in a file not in the review, the system shall open it as a read-only view (via `/file-raw`) and scroll to the definition line. These files do not appear in the sidebar.
- **Unrecognized symbols** — When no definition is found, a toast notification shall inform the user.
- **Keyword filtering** — Common language keywords (if, for, return, function, class, etc.) shall not trigger definition lookups.
- **Visual feedback** — The cursor shall change to a pointer when Cmd/Ctrl is held over code spans.
- **Shared destination handling** — The same-file / review-file / repo-file
  navigation above is also what an **AI review note's embedded link** uses
  ([doc 20](20-ai-review-notes.md) §20.6): such a link names a location by path
  and line rather than by symbol, so it skips symbol resolution and goes
  straight to the destination handling, and the jump lands on the navigation
  stack like any other.

### 13.2 Navigation Stack

- **History tracking** — The system shall maintain a navigation stack that tracks which files the user visits and their scroll positions.
- **Stack entries** — Each entry records: file ID (or file path for non-review files) and the first visible line number.
- **Scroll updates** — When the user scrolls within a file, the current stack entry's scroll position shall be updated (debounced) rather than pushing a new entry.
- **New entries** — Navigating to a different file (via sidebar click, go-to-definition, or any file switch) shall push a new entry onto the stack.
- **Forward stack clearing** — When a new file is navigated to (not via back/forward), the forward stack shall be cleared. Scrolling within the current file shall NOT clear the forward stack.
- **Back/forward buttons** — Back (chevron-left) and forward (chevron-right) buttons shall appear in a persistent navigation bar above the diff container, alongside the current file path.
- **Button state** — Back/forward buttons shall be visually disabled when there is no history in that direction.
- **Keyboard shortcuts** — Cmd+[ / Cmd+] (macOS) and Alt+Left / Alt+Right (Windows/Linux) shall trigger back/forward navigation.
- **Position restoration** — When navigating back or forward, the view shall restore to the saved scroll position.

## Non-Functional Requirements

- The navigation stack is in-memory only (not persisted across page reloads).
- Stack operations (push, back, forward) shall be instantaneous from a user perspective.
