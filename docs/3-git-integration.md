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
  - `range <from>..<to>`: `git diff <from> <to>` (the two refs passed space-separated, not as a single `<from>..<to>` argument)
  - `branch <name>`: `git diff <name>...HEAD`
  - `files <patterns>`: `git diff HEAD -- <patterns>` plus `git ls-files --others --exclude-standard -- <patterns>` for untracked files matching the patterns
  - `all`: custom walk of all tracked files
- **Structured parsing** — Diffs shall be parsed into structured objects: file path, old path (for renames), status, hunks, and lines.
- **Line metadata** — Each diff line shall include its type (add/remove/context), old line number, new line number, and content.

### 3.3 Untracked Files

- **Inclusion in uncommitted mode** — In `uncommitted` mode, untracked files (not in `.gitignore`) shall be included as "added" files.
- **Inclusion in files mode** — In `files` mode, untracked files matching the requested patterns shall likewise be included as "added" files. `git diff HEAD` never reports a never-tracked file, so without this backfill reviewing a single not-yet-added new file by path would surface nothing; the backfill is scoped to the patterns (via `git ls-files --others --exclude-standard -- <patterns>`) so unrequested new files are not pulled in.
- **Full content display** — Untracked file diffs shall show the full file content as added lines.

### 3.4 Binary Files

- **Detection** — For tracked files, binary status comes from git's own indicator (the `Binary files … differ` diff header). The first-8KB null-byte scan is **only** applied to **untracked/new** files (`createNewFileDiff` in `src/git/diff.ts`), which have no git diff header to read; tracked diffs rely solely on git's header rather than a universal second scan.
- **List only** — Binary files shall be listed in the review but not rendered as text diffs.

### 3.5 File Content Access

- **Working directory reads** — The system shall be able to read the current working directory version of any file (for context expansion and AI analysis).

## Non-Functional Requirements

### 3.6 Git Compatibility

- **Standard repos** — The system shall work with any standard git repository (no special git configuration required).
- **Child process execution** — Git commands shall be executed via `child_process` (not a git library) for maximum compatibility.

### 3.7 Performance

- **Diff speed** — Diff generation shall complete within seconds for typical repositories (hundreds of files).
