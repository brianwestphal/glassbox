# 2. Git and Diff Parsing

Test coverage for `src/git/diff.ts` — the unified diff parser, git command orchestration, and file listing.

This is one of the highest-value areas for testing. Diff parsing is complex, stateful, and handles many edge cases that are difficult to verify manually across all review modes.

## Unit Tests

### Diff Parser (`parseDiff`, `parseHunks`)

The diff parser converts raw `git diff` output into structured objects (files, hunks, lines with types and line numbers). It is pure-function logic operating on strings, making it ideal for unit testing with fixture inputs.

- **Basic hunk parsing** — A simple diff with one hunk containing added, removed, and context lines. Verify line types, old/new line numbers, and content.
- **Multi-hunk files** — Diffs with multiple hunks in the same file. Verify hunk boundaries, gap handling, and line number continuity across hunks.
- **Multi-file diffs** — A single diff output containing changes to several files. Verify correct file splitting and path extraction.
- **File status detection** — Diffs for added, modified, deleted, and renamed files. Verify the `status` field is set correctly based on diff headers.
- **Rename detection** — Diffs with `rename from`/`rename to` headers. Verify `oldPath` is captured and `status` is `renamed`.
- **No newline at EOF** — Diffs containing the `\ No newline at end of file` marker. Verify it is handled gracefully (not treated as a content line).
- **Empty diffs** — An empty string or a diff with no actual changes. Verify the parser returns an empty array without errors.
- **Context-only hunks** — Hunks that contain only context lines (no additions or deletions). These can appear in some git diff formats.
- **Line number tracking** — A diff where additions and deletions shift subsequent line numbers. Verify oldNum and newNum are correctly computed through the entire hunk.
- **Large hunks** — A diff with a very large number of lines in a single hunk (1000+ lines). Verify no performance degradation or off-by-one errors.
- **Special characters in file paths** — Paths with spaces, quotes, and unicode characters. Verify correct extraction from `diff --git a/... b/...` headers.
- **Diff header variations** — Different forms of the `@@` hunk header: `@@ -1,3 +1,5 @@`, `@@ -0,0 +1,10 @@` (new file), `@@ -1,10 +0,0 @@` (deleted file), and headers with a single line count (`@@ -1 +1,2 @@`).

### Binary File Detection

- **Git binary indicator** — Diffs containing `Binary files ... differ`. Verify the file is marked as binary.
- **Null byte scanning** — Files where the first 8KB contains null bytes. Verify detection when git doesn't report binary status itself.
- **False positives** — Text files with unusual encodings that should not be flagged as binary.

### Review Mode to Git Command Mapping (`getDiffArgs`)

Each review mode maps to specific git commands. These mappings should be verified:

- **uncommitted** — Produces `git diff HEAD` plus untracked file listing via `git ls-files --others --exclude-standard`.
- **staged** — Produces `git diff --cached`.
- **unstaged** — Produces `git diff` (no flags).
- **commit** — Given SHA `abc123`, produces `git diff abc123~1 abc123`.
- **range** — Given `main..feature`, produces `git diff main..feature`.
- **branch** — Given branch name `main`, produces `git diff main...HEAD`.
- **files** — Given patterns `src/*.ts,lib/*.js`, produces `git diff HEAD -- src/*.ts lib/*.js`.
- **all** — Lists all tracked files and creates synthetic "added" diffs for each.

### Untracked File Handling

- **Inclusion in uncommitted mode** — Untracked files appear as added files with full content.
- **Exclusion in other modes** — Staged, unstaged, commit, range, branch, and files modes do not include untracked files.
- **Gitignored files excluded** — Files matching `.gitignore` patterns are not listed by `git ls-files --others --exclude-standard`.

### Repo Detection Utilities

- **`isGitRepo`** — Returns true inside a git repo, false outside.
- **`getRepoRoot`** — Returns the absolute path to the repository root.
- **`getRepoName`** — Extracts the directory name from the root path.
- **`getHeadSha`** — Returns the current HEAD commit SHA.

## Integration Tests

### Real Git Repository Tests

**Status: Implemented** in `tests/integration/git/diff.test.ts` (16 tests).

Create temporary git repositories with known state and verify end-to-end diff collection:

- **Uncommitted mode** — ✅ Modified tracked file and untracked file both appear in diff.
- **Staged mode** — ✅ Staged changes appear; nothing staged returns empty array.
- **Commit diff** — ✅ Diffs for a specific SHA show correct removed/added lines.
- **All mode (getAllFiles)** — ✅ All tracked files returned as added diffs.
- **New file diffs (createNewFileDiff)** — ✅ Binary detection (isBinary flag); text file gets correct sequential line numbers.
- **getFileContent** — ✅ Content at HEAD, at historical SHA, empty string for nonexistent path, working-copy content.
- **getHeadCommit** — ✅ Returns 40-char hex SHA; changes after new commit.
- **parseDiff mode-only change** — ✅ chmod-only diff parsed as modified with zero hunks.

Still planned (lower priority):
- **Branch comparison** — Create a branch, add commits, verify `branch main` produces the correct diff.
- **Range diff** — Create multiple commits, verify `range` between two SHAs captures the right changes.
- **Renamed file** — Rename a file via `git mv`, verify the rename is detected with both old and new paths.
- **Empty diff scenario** — Run a mode that produces no changes (e.g., `staged` with nothing staged). Verify clean empty result.

## Edge Cases Worth Dedicated Tests

- **Max buffer exceeded** — A diff that exceeds the default `execSync` `maxBuffer`. Verify the error is caught and reported, not silently truncated.
- **Submodule entries** — Submodule diffs produce a different format. Verify they are handled (skipped or parsed) without crashing.
- **Detached HEAD** — Running in detached HEAD state. Verify `getHeadSha` still works and review modes that reference HEAD function correctly.
- **Permission-denied files** — Files that exist but can't be read. Verify graceful handling in `createNewFileDiff`.
