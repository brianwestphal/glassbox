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
- **Git LFS pointers count as binary** — An LFS-tracked file is stored as a
  three-line text pointer (`version https://git-lfs.github.com/spec/v1` / `oid
  sha256:…` / `size …`), so git emits an ordinary **text** diff with no `Binary
  files … differ` header. Detection therefore also inspects the parsed hunks: a
  diff whose either side reconstructs to a valid pointer is flagged binary and
  its hunks are dropped, since the pointer text is never reviewable content and
  would otherwise flow into the stored `diff_data`, the AI analysis prompt, and
  the export. Without this an LFS-tracked PNG rendered as a text diff of
  `oid sha256:…` with no image comparison at all. Detection is
  `src/utils/lfs.ts`.

### 3.5 File Content Access

- **Working directory reads** — The system shall be able to read the current working directory version of any file (for context expansion and AI analysis).
- **LFS content is materialized, never faked** — Image sides are read with `git
  show <ref>:<path>`, which returns the *pointer* for an LFS-tracked file. When
  the bytes are a pointer the read is retried through `git cat-file --filters`,
  which runs git's smudge filters and yields the real content. If that still
  returns a pointer — a partial clone, or LFS not installed, so the bytes are
  simply not on this machine — the read fails soft to "no image" rather than
  handing pointer text to an `<img>`, which would render as a corrupt image with
  no explanation. The same guard covers working-tree reads and the review-note
  artifact route, since doc 20 §20.5 routes screenshot artifacts through LFS by
  design.

## Non-Functional Requirements

### 3.6 Git Compatibility

- **Standard repos** — The system shall work with any standard git repository (no special git configuration required).
- **Child process execution** — Git commands shall be executed via `child_process` (not a git library) for maximum compatibility.

### 3.7 Performance

- **Diff speed** — Diff generation shall complete within seconds for typical repositories (hundreds of files).
