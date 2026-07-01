---
name: absorb-tickets
description: Absorb domotion svg-scrubber `.ticket` files (and their frame PNGs) from the repo root into Hot Sheet tickets, then move the originals to the Trash. Use when the user has svg-scrubber review exports (`*.ticket` + `demo-*.png`) sitting in the project root to file.
allowed-tools: Bash, Read
---
<!-- absorb-tickets-skill-version: 1 -->

Import **svg-scrubber** `.ticket` files into Hot Sheet, then trash the originals.

## Background

The domotion **svg-scrubber** tool, run in *review mode*, lets a reviewer scrub
an animated SVG (e.g. `assets/demo.svg`), mark a problem at a specific frame /
time-range / region, and export it. Each exported issue lands in the project
root as a pair:

- `<slug>-<stamp>.ticket` — a JSON payload (`tool: "svg-scrubber"`, `version: 1`)
- `<slug>-<stamp>.png` — the captured frame snapshot (referenced by the ticket's
  `framePng` field)

The `.ticket` JSON is designed to map **straight onto Hot Sheet**: its `title`,
`category`, and `details` fields drop directly into `hotsheet_create_ticket`
(the `category` enum — `bug` / `issue` / `feature` / `task` / `investigation` /
`requirement_change` — is already exactly Hot Sheet's category set, so **no
mapping is needed**). The `details` field is pre-rendered Markdown containing the
SVG path, frame time, selected range, and region coordinates.

Example `.ticket`:

```json
{
  "tool": "svg-scrubber",
  "version": 1,
  "title": "unnecessary crossfade",
  "category": "bug",
  "svgName": "demo",
  "framePng": "/Users/westphal/Documents/glassbox/demo-1782875621671.png",
  "details": "…markdown with SVG file / frame time / range / region…"
}
```

## What this skill does

For every `*.ticket` in the repo root, in `createdAt` order:

1. Create a Hot Sheet ticket from `title` / `category` / `details`.
2. Attach the corresponding frame PNG (`framePng`) to the created ticket.
3. Move the `.ticket` **and** its PNG to the macOS Trash.

Then report a summary of what was absorbed.

## Procedure

### 1. Find the tickets

The repo root is the directory containing `.hotsheet/` (this project:
`/Users/westphal/Documents/glassbox`). List the pending exports:

```bash
cd "$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || echo ~/Documents/glassbox)"
ls -1 *.ticket 2>/dev/null | sort
```

If there are **no** `.ticket` files, report "Nothing to absorb — no `.ticket`
files found." and stop.

### 2. Absorb each ticket

Process the tickets oldest-first (sort by the JSON `createdAt`). For each file,
read its fields with `jq` (validate `tool == "svg-scrubber"` first — skip and
warn on anything else):

```bash
f=demo-1782875621671.ticket
jq -r '.tool, .title, .category, .svgName, (.framePng // ""), .details' "$f"
```

Then, per ticket:

- **Create the Hot Sheet ticket** (preferred — MCP tool, since the channel is
  connected). Prefix the title with the SVG name for scannability, since many of
  these titles look alike in the list:

  Call `hotsheet_create_ticket` with:
  - `title`: `"<svgName>: <title>"` (e.g. `"demo: unnecessary crossfade"`)
  - `category`: the ticket's `category` verbatim
  - `details`: the ticket's `details`, **with the frame-snapshot line rewritten**
    (see below)
  - `up_next`: `false` (these are freshly-filed incoming issues; let the
    maintainer prioritize them)

  **Rewrite the frame-snapshot line.** The scrubber `details` ends with a line
  like `` - **Frame snapshot:** `/abs/path/demo-<stamp>.png` `` — an absolute
  path to a file this skill is about to move to the Trash, so that path would be
  dead in the ticket. Since the PNG gets **attached** (durable copy), replace
  that line so it points at the attachment instead:

  ```
  - **Frame snapshot:** `demo-<stamp>.png` _(attached)_
  ```

  (basename only, no path). Leave the `- **SVG file:**` line's absolute path
  as-is — that file is *not* trashed.

  Fallback (curl) — re-read `.hotsheet/settings.json` for the current `secret`
  if the channel isn't available:

  ```bash
  curl -s -X POST http://localhost:4174/api/tickets \
    -H "Content-Type: application/json" \
    -H "X-Hotsheet-Secret: <secret>" \
    -d '{"title": "<svgName>: <title>", "defaults": {"category": "<category>", "up_next": false}, "details": "<details>"}'
  ```

  Capture the returned ticket **id** / number.

- **Attach the frame PNG.** Resolve the PNG path from the ticket's `framePng`
  field; if that's null/empty, fall back to the sibling `<basename>.png` next to
  the `.ticket`. Only attach if the file exists on disk.

  Call `hotsheet_add_attachment` with `{ "ticket_id": <id>, "path": "<pngPath>" }`
  (the tool reads the bytes and posts multipart — the image becomes the durable
  copy, so it's safe to trash the original next). If the PNG is missing, still
  create the ticket but note the missing image in your summary.

  Fallback (curl):

  ```bash
  curl -s -X POST http://localhost:4174/api/tickets/<id>/attachments \
    -H "X-Hotsheet-Secret: <secret>" \
    -F "file=@<pngPath>"
  ```

- **Trash the originals** — ONLY after the ticket is confirmed created (has an
  id) and, if a PNG existed, it was attached. Use the macOS `trash` CLI so the
  files land in the Trash with Put Back support (never `rm`):

  ```bash
  trash "<basename>.ticket" "<pngPath>"
  ```

  If `trash` is unavailable, fall back to `mv "<file>" ~/.Trash/`.

  **Sandbox note:** `trash` writes to `~/.Trash`, which is outside the command
  sandbox's writable paths, so the move fails with `afpAccessDenied` under the
  sandbox. Run this trash step with the sandbox disabled (or add `~/.Trash` to
  the sandbox write allowlist via `/sandbox`). Everything else — jq, ticket
  creation, attachment — runs fine inside the sandbox.

### 3. Report

Summarize: for each absorbed `.ticket`, the new Hot Sheet ticket number + title,
whether a PNG was attached, and that both originals were trashed. Note any
skipped files (non-scrubber JSON, missing PNG, create/attach failures — leave
those originals in place, do **not** trash them).

## Safety rules

- **Never trash a file whose Hot Sheet ticket wasn't successfully created.** The
  Trash is recoverable, but a silently-dropped issue is not.
- **Attach before trashing.** The Hot Sheet attachment is the durable copy of the
  frame; the on-disk PNG is disposable once attached.
- **One Hot Sheet ticket per `.ticket` file.** Don't batch multiple issues into
  one ticket — each scrubber export is a distinct reviewer-reported problem.
- If a Hot Sheet request fails (connection refused / 403), re-read
  `.hotsheet/settings.json` for the current `port` and `secret`, warn the user,
  and stop before trashing anything.
