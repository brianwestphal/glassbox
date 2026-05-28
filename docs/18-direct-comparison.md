# 18. Direct Path Comparison

Requirements for reviewing the difference between **two arbitrary files or two
arbitrary folders** given as explicit paths, independent of git history.

Every other review mode (doc 3) derives its diff from git history inside a
single repository. Direct comparison is different: the user names two paths on
disk — `A` and `B` — and Glassbox shows the diff of `A` (old side) against `B`
(new side). Neither path needs to live in a git repository, and they need not
be related to each other at all.

The diff itself is still produced by git: `git diff --no-index <A> <B>` works on
any two filesystem paths and requires only that the `git` binary is installed,
not that a repository exists. This is the same primitive the `all` mode already
uses (`git diff --no-index /dev/null .`).

## Functional Requirements

### 18.1 Invocation

- **CLI option** — The CLI shall accept `--diff <pathA> <pathB>`, taking the two
  paths as the two following arguments. `pathA` is the **old** (left) side and
  `pathB` is the **new** (right) side of the resulting diff.
- **No-repo operation** — `--diff` shall work outside any git repository. The
  startup git-repository check (doc 2, FR-2.3 / doc 3, FR-3.1) shall be skipped
  for this mode.
- **Path resolution** — Both paths shall be resolved to absolute paths before
  use, relative to the current working directory.
- **Path validation** — Each path shall be validated to exist before the review
  is created. A missing path shall produce a clear error and a non-zero exit.
- **Type agreement** — Both paths shall be the same kind: two files, or two
  folders. Comparing a file against a folder (or vice versa) shall produce a
  clear error and a non-zero exit.
- **Empty diff** — If the two paths are byte-for-byte identical (no differing
  files), the CLI shall report that there are no differences and exit without
  starting the server, consistent with the other modes' empty-diff behavior.

### 18.2 File-vs-File Comparison

- **Single-file diff** — When both paths are files, the review shall contain a
  single entry showing the diff of `A` against `B`.
- **Differing names** — When `A` and `B` have different basenames (e.g.
  `old.ts` vs `new.ts`), the entry shall be presented with `A`'s name as the old
  path and `B`'s name as the new path (the same shape the UI already uses for a
  renamed file).
- **Identical files** — Two identical files shall be treated as an empty diff
  (see FR-18.1).

### 18.3 Folder-vs-Folder Comparison

- **Recursive walk** — When both paths are folders, the comparison shall recurse
  through both trees.
- **Pairing by relative path** — Files shall be paired by their path relative to
  the respective root folder. A file present under both roots at the same
  relative path is a **modified** (or unchanged) file; one present only under
  `A` is **deleted**; one present only under `B` is **added**.
- **No filtering by default** — All files under both trees shall be compared.
  `.gitignore` rules shall **not** be applied (the folders may not be repos, and
  predictable "compare everything" behavior is the goal). A future enhancement
  may add an opt-in exclude/ignore mechanism (see FR-18.8).
- **Relative display paths** — Each file entry shall be displayed by its path
  relative to the compared roots (e.g. `src/util.ts`), not by the absolute or
  root-prefixed path that `git diff --no-index` emits internally.

### 18.4 Diff Generation

- **Engine** — Diffs shall be generated via `git diff --no-index <A> <B>` (with
  the standard context flag, `-U3`) and parsed by the existing diff parser
  (doc 3, FR-3.2). `git diff --no-index` exits non-zero when differences are
  found; this is expected and shall not be treated as an error.
- **Binary and image files** — Binary detection (doc 3, FR-3.4) and image diff
  (doc 4, §4.3) shall work for directly compared paths. The old/new bytes for an
  image entry shall be read from the two filesystem paths directly rather than
  from git refs.
- **SVG handling** — SVG dual mode (doc 4, §4.3.1) shall work for directly
  compared SVG files, reading each side from disk.

### 18.5 Context Expansion

- **Source of truth** — Hunk context expansion (doc 4, §4.4) shall read
  additional lines from the **new-side path** (`B`) for a given file, since the
  on-screen line numbers track the new side. For a deleted file (present only in
  `A`), expansion shall read from the old-side path.

### 18.6 Review Record and Data Location

- **Standalone bootstrap** — In `--diff` mode the review record shall be created
  with:
  - `repo_path` = the current working directory,
  - `repo_name` = a human-readable label derived from the two paths (e.g.
    `"old.ts ↔ new.ts"` or `"dist-old ↔ dist-new"`),
  - `head_commit` = empty (there is no HEAD; the empty sentinel also lets a
    re-run of the same `--diff` match the existing review and refresh it, the
    same way the other modes compare HEAD SHAs).
- **Data directory** — PGLite data shall continue to live in the global
  `~/.glassbox/data/` location (doc 9). The per-review markdown export
  (`.glassbox/latest-review.md`, doc 6) shall be written under the current
  working directory's `.glassbox/`.
- **History** — Direct comparisons shall appear in review history (doc 1) like
  any other review, labeled by their `repo_name`.

### 18.7 Mode Persistence

- **Round-trip** — The `diff` mode shall serialize to and parse from its stored
  mode string so an in-progress direct comparison can be resumed and its diffs
  refreshed, the same way other modes round-trip (doc 3 / `parseModeString` /
  `getModeString`). The stored form shall capture both absolute paths.

### 18.8 Feature Availability Outside a Repo

Some features assume a repository. In `--diff` mode:

- **Go-to-definition / outline repo scan** (doc 13) operates on a repo tree;
  outside a repo it shall degrade gracefully (no crash) and may be limited to
  the compared paths.
- **Claude channel** (doc 17) writes `.mcp.json` into a repo. When there is no
  repo, the channel shall be unavailable rather than erroring.
- **gitignore prompt** (doc 6) shall not be shown when the working directory is
  not a git repository.
- **AI analysis** (doc 7) operates on the diff payload and shall work normally.

## Non-Functional Requirements

### 18.9 Safety

- **No shell interpolation** — As with all git invocations (doc 14, FR-14.3),
  the two user-supplied paths shall be passed as argv array elements to
  `git diff --no-index`, never interpolated into a shell string.
- **Path containment is not assumed** — Because the paths are explicitly chosen
  by the user invoking their own CLI, they may point anywhere on disk; this mode
  does not impose repo-root containment. (The HTTP server remains bound to
  localhost per doc 14, FR-14.1, so the diff is not exposed to the network.)

### 18.10 Performance

- **Large trees** — Folder comparison shall complete within seconds for typical
  directory trees (hundreds of files), bounded by `git diff --no-index`
  performance and the existing diff size guards (doc 4 large-line truncation).

### 18.11 Desktop App

- **CLI-only** — Direct comparison is a CLI-launched feature. There is no
  in-app file/folder picker in the desktop window; users invoke `glassbox
  --diff <A> <B>` from their terminal (which on the desktop app routes
  through the bundled CLI launcher). Adding a native picker UI was
  considered and explicitly deferred — the CLI entry point is sufficient
  for the intended workflow.

## Open Questions / Future Work

- An opt-in exclude or `.gitignore`-respecting mode for folder comparison
  (FR-18.3).
