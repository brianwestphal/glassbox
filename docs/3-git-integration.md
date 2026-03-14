# 3. Git Integration

Requirements for interacting with git repositories.

## Functional Requirements

### 3.1 Repository Detection

- **Git repo check** — The system shall verify it is running inside a git repository before proceeding.
- **Root path resolution** — The system shall resolve the repository root path (for consistent file path handling).
- **Repository name** — The system shall extract the repository name from the root directory.
- **HEAD SHA** — The system shall capture the current HEAD commit SHA.

### 3.2 Diff Generation

- **Mode-specific commands** — Each review mode shall map to the appropriate git commands:
  - `uncommitted`: `git diff HEAD` plus `git ls-files --others --exclude-standard` for untracked files
  - `staged`: `git diff --cached`
  - `unstaged`: `git diff`
  - `commit <sha>`: `git diff <sha>~1 <sha>`
  - `range <from>..<to>`: `git diff <from>..<to>`
  - `branch <name>`: `git diff <name>...HEAD`
  - `files <patterns>`: `git diff HEAD -- <patterns>`
  - `all`: custom walk of all tracked files
- **Structured parsing** — Diffs shall be parsed into structured objects: file path, old path (for renames), status, hunks, and lines.
- **Line metadata** — Each diff line shall include its type (add/remove/context), old line number, new line number, and content.

### 3.3 Untracked Files

- **Inclusion in uncommitted mode** — In `uncommitted` mode, untracked files (not in `.gitignore`) shall be included as "added" files.
- **Full content display** — Untracked file diffs shall show the full file content as added lines.

### 3.4 Binary Files

- **Detection** — Binary files shall be detected via git's binary indicator and by scanning the first 8KB for null bytes.
- **List only** — Binary files shall be listed in the review but not rendered as text diffs.

### 3.5 File Content Access

- **Working directory reads** — The system shall be able to read the current working directory version of any file (for context expansion and AI analysis).

## Non-Functional Requirements

### 3.6 Git Compatibility

- **Standard repos** — The system shall work with any standard git repository (no special git configuration required).
- **Child process execution** — Git commands shall be executed via `child_process` (not a git library) for maximum compatibility.

### 3.7 Performance

- **Diff speed** — Diff generation shall complete within seconds for typical repositories (hundreds of files).
