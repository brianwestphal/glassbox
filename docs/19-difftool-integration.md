# 19. Git Difftool Integration

Requirements for using Glassbox as a registered **`git difftool`**, so that
`git difftool <a> <b>` opens the changed files in a Glassbox review.

This builds on **direct path comparison** (doc 18): the difftool bridge
ultimately produces a `--diff`-style review of file pairs handed over by git.
Where doc 18 is about a user naming two paths explicitly, this document is
about the `git difftool` plumbing that feeds those pairs in automatically —
the companion `glassbox-difftool` binary, its registration, and the behavior
of both of git's difftool invocation modes.

## Background: how `git difftool` invokes a tool

`git difftool` has two invocation modes, and they behave very differently:

- **`--dir-diff`** — git materializes two temporary directory snapshots of the
  two sides and invokes the configured tool **once**, passing both directories.
  The tool shows every changed file in a single session. This is the mode the
  cross-platform desktop launch already supports.
- **Per-file** (no `--dir-diff`) — git invokes the configured tool **once per
  changed file, sequentially**, and **waits for each invocation to exit before
  launching the next**. git passes the two temp file paths (`$LOCAL` =
  old/left, `$REMOTE` = new/right) for that one file.

Two facts about per-file mode drive this design:

1. **git tells the tool where it is in the sequence.** On each per-file
   invocation git sets `GIT_DIFF_PATH_COUNTER` (1-based index of the current
   file) and `GIT_DIFF_PATH_TOTAL` (total number of changed files). The tool
   can therefore detect the **last** file (`COUNTER == TOTAL`).
2. **git deletes the temp files the instant the tool exits.** The `$LOCAL` /
   `$REMOTE` paths are short-lived temp copies; once the tool process exits,
   git removes them and moves on. A tool that wants the content must read it
   **before** it exits.

## The problem this document resolves

In a **browser** (npm) install, the per-file wrapper historically ran the
Glassbox server in the **foreground** for the lifetime of the review, and the
server did not exit when the browser tab closed. Because git waits for each
per-file invocation to exit, git would hang on the first file until the user
pressed Ctrl-C in the terminal, then lurch to the second file, and so on —
one server, one tab, one file at a time, with a manual interrupt between each.
Desktop mode avoided the hang only because closing the native window killed
the sidecar and let git advance.

The fix is to stop treating each per-file invocation as a whole review session.
Instead, **accumulate** every file git hands over into a single live review —
the same single-session experience `--dir-diff` already gives, and the same
experience tools like Kaleidoscope give in per-file mode.

## The model: thin-client wrapper + accumulating server

The companion binary `glassbox-difftool` becomes a **thin client**, modeled on
how Kaleidoscope's `ksdiff` works: it forwards each file to a single
long-lived Glassbox server and returns quickly, so git advances through the
whole change set, and all files pile into **one** review.

```
git difftool HEAD~1 HEAD          (browser install, 3 changed files)
  │
  ├─ file 1/3  glassbox-difftool $LOCAL $REMOTE
  │     read both file contents → start detached server (none running yet)
  │     → POST file 1 to the active review → EXIT  ──► git advances
  │
  ├─ file 2/3  glassbox-difftool $LOCAL $REMOTE
  │     read both file contents → find running server
  │     → POST file 2 to the active review → EXIT  ──► git advances
  │
  └─ file 3/3  glassbox-difftool $LOCAL $REMOTE   (COUNTER == TOTAL → last)
        read both file contents → find running server
        → POST file 3 → HOLD the connection open  ──► git difftool stays open
              user reviews all 3 files in one browser tab
              user clicks "Done"  ── or ── presses Ctrl-C
              → hold releases → server tears down → git difftool returns
```

## Functional Requirements

### 19.1 Registration and the companion binary

- **Companion binary** — Glassbox shall ship a `glassbox-difftool` binary
  alongside `glassbox`, installed onto PATH by the same mechanisms (npm `bin`
  map; the desktop **Install CLI** affordance). The two binaries shall always
  be installed and updated together.
- **Registration commands** — `glassbox --register-difftool [--local]` shall
  write the git config keys that point `git difftool` at `glassbox-difftool`;
  `glassbox --unregister-difftool` shall remove only the keys Glassbox set.
  Registration shall default to `--global` scope. The same controls shall be
  available under **Settings → General** (global scope only).
- **Non-destructive registration** — registration shall refuse to overwrite a
  pre-existing third-party `diff.tool` unless `--force` is given, and
  unregistration shall not delete a third-party tool's keys.

### 19.2 `--dir-diff` mode (single invocation)

- **Whole change set in one review** — `git difftool --dir-diff <a> <b>` shall
  open the entire change set as a single review, in both browser and desktop
  installs.
- **Symlink dereferencing** — because git materializes the right-hand snapshot
  as symlinks into the working tree (which plain `git diff --no-index` would
  render as delete+add pairs), the wrapper shall dereference those symlinks
  into a temp tree before handing the two directories to the `--diff` engine
  (doc 18), and clean the temp tree up when the session ends.
- **Recommended-but-not-required** — `--dir-diff` shall remain fully supported
  as an optimization, but shall **not** be required for a good experience: the
  default per-file invocation (FR-19.3) shall also produce a single-session
  review.

### 19.3 Per-file accumulating model (default)

- **Single accumulating review** — `git difftool <a> <b>` **without**
  `--dir-diff` shall accumulate every file git hands over into a **single**
  live review, displayed in one browser tab (or one desktop window), rather
  than one review/tab/window per file.
- **No manual interrupt between files** — git shall advance from each file to
  the next automatically, with no Ctrl-C required between files.
- **Content captured before exit** — for each invocation the wrapper shall read
  the full `$LOCAL` (old) and `$REMOTE` (new) file contents **before** the
  wrapper process exits, because git deletes the temp files on exit. The
  content is sent to the server; the (soon-deleted) paths are not relied upon
  afterward.
- **Filename preserved** — each accumulated entry shall be labeled with the
  file's path as git presents it, the same way per-file mode already labels the
  file under review.

### 19.4 Thin-client wrapper protocol

For each per-file invocation, `glassbox-difftool` shall:

1. **Read** the `$LOCAL` and `$REMOTE` contents into memory.
2. **Discover or start** the accumulating server (FR-19.6): if a running
   server is found, use it; otherwise start one **detached** and wait until it
   is ready to accept requests.
3. **Append** the file pair to the active review via the append endpoint
   (FR-19.7).
4. **Exit immediately** for every file except the last (FR-19.5).

- **Fast return** — except for the holding behavior in FR-19.5, the wrapper
  shall return promptly so git advances without perceptible delay.

### 19.5 Last-file hold and session lifecycle

- **Last-file detection** — the wrapper shall treat an invocation as the final
  file of the session when `GIT_DIFF_PATH_COUNTER == GIT_DIFF_PATH_TOTAL`.
- **Hold the terminal open** — on the final file, after appending its content,
  the wrapper shall **hold a connection open to the server** instead of exiting,
  so the `git difftool` command stays running in the terminal for the duration
  of the review. (All earlier files have already been appended, so the review
  is complete on screen.)
- **Clean end via "Done"** — the review UI shall present a **"Done"** affordance
  (shown when the review is a difftool session) that ends the session: it shall
  cause the held connection to release, the wrapper to exit `0`, and the
  `git difftool` command to return to the prompt cleanly — no Ctrl-C needed.
- **Fallback end via Ctrl-C** — pressing Ctrl-C on the still-running
  `git difftool` command shall also end the session: it terminates the holding
  wrapper, whose dropped connection the server shall observe and respond to by
  shutting down. Ctrl-C is the fallback; "Done" is the clean path.
- **Teardown follows the hold** — the accumulating server's lifetime shall be
  bound to the holding connection: when that connection releases or drops
  (Done, Ctrl-C, or browser/tab close per FR-19.8), the detached server shall
  shut down so nothing is left orphaned. A generous idle timeout (no holding
  connection and no connected browser) shall serve only as a last-resort
  backstop, not the primary mechanism.

### 19.6 Single accumulating server (session grouping)

- **One server** — there shall be a single accumulating difftool server at a
  time, consistent with Glassbox's existing single-instance lock
  (`~/.glassbox/glassbox.lock`, doc 9). The running server is the grouping
  mechanism: git is never told the files are related, so the singleton is what
  ties them into one review.
- **Discovery** — the wrapper shall discover a running server via a lockfile
  that records its port (and shall fall back to starting one if none is
  recorded or the recorded server is not answering).
- **Concurrent runs merge** — if a second, unrelated `git difftool` run starts
  while a session is active, its files shall append into the same active review
  (the Kaleidoscope behavior). Per-invocation isolation is explicitly **not** a
  requirement; this trade is accepted as a rare case.

### 19.7 Append-file API

- **Endpoint** — the server shall expose an endpoint that appends a single file
  to the **active** difftool review, accepting the **raw old and new content**
  (e.g. `{ path, oldContent, newContent }`) plus the display path. It shall
  **not** require git refs or rely on the (deleted) temp paths; the wrapper has
  already resolved the content.
- **Diff production** — the server shall produce the file's diff from the raw
  content using the existing diff machinery (the same parsing used for
  `--diff`, doc 18), including binary/image handling where the two sides are
  binary.
- **Image/SVG bytes persisted for visual comparison** — because a difftool
  review has no git refs or working tree for the image-comparison routes to
  re-read, the append shall persist the raw old/new bytes of binary and SVG
  files so the metadata / difference / slice modes and the SVG rendered view
  work the same as in any other review. The persisted bytes shall be scoped to
  the session and removed when it ends.
- **Typed and validated** — the endpoint shall follow the project's typed API
  conventions (a zod request/response schema in `src/api/`, body validation on
  the server) like every other endpoint.

### 19.8 Live file list during a session

- **Sidebar updates as files arrive** — because files are appended one at a
  time while the review is already open, the sidebar file list shall update to
  show each newly appended file without a manual reload. (The existing review
  model fixes the file set at creation; a difftool session shall instead let
  the set grow during the session.)
- **Tab-close ends the session** — closing the browser tab shall be treated as
  an end-of-session signal (the browser-mode equivalent of closing the desktop
  window): the server shall observe the lost client and tear down per FR-19.5.

### 19.9 Desktop mode

- **Same accumulating model** — in a desktop (Tauri) install, per-file
  invocations shall likewise accumulate into a **single** native window, rather
  than opening a new window per file.
- **Forward to the running app** — when a Glassbox difftool window is already
  open, subsequent per-file invocations shall append their file to that running
  app's active review rather than launching another window.
- **Window-close lifecycle** — the desktop session shall end when the native
  window is closed (the signal desktop mode already has): closing the window
  shall release any holding wrapper and tear down, the same way browser
  tab-close / "Done" does. The last-file hold (FR-19.5) still applies so the
  `git difftool` command stays attached for the session's duration.

### 19.10 Behavior when the path counter is unavailable

- **Graceful fallback** — if `GIT_DIFF_PATH_COUNTER` / `GIT_DIFF_PATH_TOTAL`
  are not provided by the running git (older or differently-configured git),
  the wrapper shall still accumulate files (each invocation appends and exits),
  and the session shall rely on the server-side end signals — "Done" and
  tab/window close (FR-19.5, FR-19.8) — rather than the last-file hold. The
  feature shall not require the counter to function; the counter only enables
  the terminal-attached hold.

## Non-Functional Requirements

### 19.11 Safety

- **No shell interpolation** — as with all git and path handling (doc 14,
  FR-14.3), file paths and content shall never be interpolated into a shell
  string. The wrapper reads files via the filesystem API and sends content over
  loopback HTTP.
- **Loopback only** — the accumulating server shall bind exclusively to
  `127.0.0.1` (doc 14, FR-14.1). The append endpoint is reachable only from the
  local machine.
- **Localhost trust model** — consistent with the rest of Glassbox, there is no
  authentication on the local endpoint; the threat model trusts the local
  machine (doc 14).

### 19.12 Robustness and performance

- **Startup race** — the first per-file invocation starts the detached server;
  later invocations must find it. The wrapper shall handle the window where the
  server is starting but not yet listening (e.g. probe-with-retry against the
  recorded port / a readiness handshake), so no file is dropped.
- **Promptness** — appending a file and returning shall be fast enough that git
  stepping through a typical change set (tens of files) feels immediate.
- **No dropped files** — every file git hands over shall appear in the review;
  if appending a file fails, the failure shall be surfaced rather than silently
  skipped.
- **Difftool environment isolation** — when git invokes a tool under
  `git difftool` it exports `GIT_EXTERNAL_DIFF=git-difftool--helper` (plus the
  per-file `GIT_DIFF_PATH_COUNTER` / `GIT_DIFF_PATH_TOTAL`) into the tool's
  environment, and those variables are inherited by every child process. Because
  Glassbox builds its diffs by running git itself (`git diff --no-index`,
  `git show`), every internal git subprocess shall run with these variables
  scrubbed from its environment. Left in place, the inner git call honors
  `GIT_EXTERNAL_DIFF` and re-invokes the difftool helper — which re-launches
  `glassbox` — instead of emitting a textual patch, producing runaway recursion
  and an empty diff (the review then reports "No changes found for the specified
  mode", with a desktop install also surfacing "Error: Server failed to start"
  from the nested launch). The scrub lives in the shared low-level git helper
  (`scrubbedGitEnv()` in `src/git/repo.ts`) so it applies uniformly regardless of
  how Glassbox was invoked.

### 19.13 Backward compatibility

- **Registration unchanged** — existing registrations shall keep working; this
  change is in the wrapper's runtime behavior, not in the git config keys.
- **`--dir-diff` unchanged** — the single-invocation `--dir-diff` path shall
  continue to behave as before (FR-19.2).
- **Native modes preferred** — the documentation shall continue to note that
  Glassbox's native ref-aware modes (`glassbox --commit`, `--branch`,
  `--range`, …) produce cleaner diffs than `git diff --no-index` and remain the
  recommended workflow; the `git difftool` integration exists for muscle
  memory.

## Open Questions / Future Work

- **Idle-timeout default** — the exact backstop idle timeout (FR-19.5) is
  unspecified; a generous default (e.g. several minutes) is expected, tuned
  during implementation. The primary lifecycle is the held connection, so the
  timeout should rarely fire.
- **Multiple simultaneous sessions** — per FR-19.6, concurrent unrelated
  `git difftool` runs intentionally merge into one review. A future enhancement
  could key sessions and isolate them if a real need emerges.
- **README/help sync** — the README "Use as `git difftool`" section currently
  describes per-file mode as "waits for each review window to close before
  opening the next." That description shall be updated to the accumulating model
  when this lands.
