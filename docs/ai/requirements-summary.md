# Glassbox Requirements Summary

A synthesized view of every requirements document under `docs/`, organized
by theme so a fresh AI session can orient without opening each file. Each
entry is 3–5 sentences and carries a status marker:

- **Shipped** — implementation exists and matches the spec.
- **Partially built** — some parts shipped, others still open.
- **Design only** — spec written, implementation not confirmed.
- **Deferred / Superseded** — kept for history; see newer doc.

> **Maintenance rule.** Update this file in the same pass whenever a
> requirements doc is added, renumbered, re-scoped, or a feature's status
> changes. See §19 for the trigger list.

## 1. Product vision and foundations

**Glassbox** is a locally-running code-review tool for AI-generated code.
Launched from the CLI in any git repo, it opens a browser-based diff
viewer where users annotate lines with categorized feedback. On completion
(and continuously, debounced), annotations are exported as structured
markdown that AI tools like Claude Code and Cursor can read and act on.

Foundational decisions (see `ARCHITECTURE.md`, `CLAUDE.md`):

- **Local-first.** All data in `~/.glassbox/` and the project's
  `.glassbox/`. No accounts, telemetry, or cloud. AI is the only
  optional outbound call.
- **127.0.0.1 only.** The server binds exclusively to loopback. No auth
  (threat model: the local machine is trusted).
- **Embedded Postgres.** PGLite WASM, raw SQL, no ORM.
- **Custom JSX runtime**, not React. HTML is rendered server-side for
  initial load; client JS adds interactivity.
- **Distribution:** npm (`npm i -g glassbox`) and native desktop via Tauri.

## 2. Review workflow (`1-review-workflow.md`) — **Shipped**

Reviews are created on launch against a git repo. Eight review modes:
`uncommitted` (default), `staged`, `unstaged`, `commit <sha>`,
`range <from>..<to>`, `branch <name>`, `files <patterns>`, `all`. The
system captures HEAD SHA and repo name/path. Empty-diff modes are
reported, not started.

Resumption rules: same HEAD and mode → reuse the in-progress review,
refresh its diffs, fuzzy-migrate annotations. `--resume` across HEADs
reopens the latest in-progress as-is. `--resume` with none found starts
a new review. Completed reviews are reopenable; history is browsable
with individual or bulk delete. On completion the export is immediate
and a gitignore prompt (30-day cooldown) appears. Instance locking is
PID-based in `~/.glassbox/`; demo mode bypasses the lock.

## 3. CLI and server (`2-cli-and-server.md`) — **Shipped**

CLI: `glassbox [options]`, default `--uncommitted`. `--help`/`-h`, unknown
options error. Options cover all review modes plus `--port`, `--resume`,
`--no-open`, `--strict-port`, `--project-dir`, `--check-for-updates`,
`--debug`, `--ai-service-test`, `--demo:N`.

Server is Hono on `@hono/node-server`, bound to `127.0.0.1`, default port
`4183` with up to 20-port auto-fallback (unless `--strict-port`). Context
middleware injects `reviewId`, `currentReviewId`, `repoRoot` via
`AppEnv`. Static assets come from co-located `client/` (prod) or
`../dist/client/` (dev). Startup stdout line `Glassbox running at
http://localhost:{port}` is parsed by the Tauri sidecar to detect
readiness.

Route groups: `/api/*` (reviews/files/annotations/context/settings),
`/api/ai/*` (config/keys/analysis/prefs), `/api/themes/*`,
`/api/channel/*`, plus page routes `/`, `/file/:fileId`,
`/review/:reviewId`, `/history`. Browser launch uses
`open` (macOS) / `start` (Windows) / `xdg-open` (Linux); suppressed by
`--no-open`. Error handling returns HTTP 4xx with descriptive bodies.

## 4. Git integration (`3-git-integration.md`) — **Shipped**

Verifies git repo (unless demo), resolves repo root and name, captures
HEAD SHA. Each mode maps to specific git invocations (see
`code-summary.md` §13 for the table). Diffs parse into structured
FileDiff objects with per-line type/old-num/new-num/content. Untracked
files are included in `uncommitted` mode as "added" with full file
content. Binary files are detected via git's indicator + 8 KB null-byte
scan; listed but not rendered as text diffs. Working-directory file
reads power context expansion and AI analysis. Implemented via
`child_process` (no git library) using `spawnSync`/`execFileSync` with
argv arrays — never string interpolation into a shell.

## 5. Diff viewing (`4-diff-viewing.md`) — **Shipped**

Split mode is default; unified mode is available. Added/deleted files
always render unified regardless of setting. Line numbers render as CSS
pseudo-elements so they're excluded from selection/copy. In split mode,
text selection is single-column. Status badges indicate added / modified
/ deleted / renamed, and files can be toggled reviewed/pending.

**Image comparison** (PNG/JPEG/GIF/WebP): metadata mode diffs parsed
headers (no native deps); difference mode uses CSS `mix-blend-mode:
difference`; slice mode overlays center-to-center with a draggable cut
line at any angle. Added/deleted images show metadata + zoom/pan viewer
only. **SVGs** get a Code/Rendered toggle; Rendered rasterizes via
`@resvg/resvg-wasm` at 10× (max 8000 px in largest dimension), default
300×150 per HTML spec. The user's Code/Rendered choice is remembered
across files.

Other controls: wrap toggle, ignore-whitespace toggle (regenerates with
`-w`, persisted in user_preferences), syntax highlighting (auto-detected
or user-selected), context expansion (live from working tree), symbol
outline (functions/classes/methods) with click-to-navigate, and in-diff
find (`Cmd/Ctrl+F`) with match nav and Escape dismiss. In Tauri, the
native Find menu routes to the in-app find bar.

## 6. Annotations (`5-annotations.md`) — **Shipped**

Click a diff line to open the annotation form (clicks distinguished from
drag-selects by ≤5 px movement). Each annotation has content, category,
line number, and side. Seven categories with AI-consumption semantics:
**bug**, **fix**, **style**, **pattern-follow**, **pattern-avoid**,
**note**, **remember**. Edit via double-click or edit button; reclassify
via category badge; delete per-annotation. Annotations can be dragged to
a new line/side within the same file.

Stale handling: on diff refresh, fuzzy matching within a 10-line radius
attempts to migrate annotations. Unmatched are marked stale (red
strikethrough). Users can individually mark-current, or batch
delete-all-stale / keep-all-stale. Annotations persist immediately and
survive restarts. Sidebar shows per-file annotation counts and stale
indicators.

## 7. Export (`6-export.md`) — **Shipped**

Writes `<repo>/.glassbox/latest-review.md` (overwritten, always current)
and `<repo>/.glassbox/review-{id}.md` (archived). Continuous auto-export
is debounced at **2 seconds** after any annotation mutation; completion
forces immediate export. Format includes: header (repo/mode/id/date/file
count/annotation count), category summary table, **Items to Remember**
section (pulled from `remember` annotations, with preamble asking AI
tools to persist to their config), per-file grouped annotations with
line + category + content, and an **Instructions for AI Tools** section
with category semantics. Paths are relative to repo root. When a review
is deleted its export file is deleted too; reopening a review preserves
the existing export.

## 8. AI analysis (`7-ai-analysis.md`) — **Shipped**

Optional; app is fully functional without any AI configured. Three
platforms: Anthropic (Claude), OpenAI (GPT), Google (Gemini).

**Risk** — six dimensions scored 0.0–1.0 (security, correctness,
error-handling, maintainability, architecture, performance). Files
ranked by the **max** dimension (not averaged). Each file gets a
rationale + line-level notes; scores display as sidebar badges; users
can sort by individual dimensions.

**Narrative** — determines an optimal reading order (types → utils →
business logic → integration → config/build → tests). Each file gets a
rationale and walkthrough notes explaining connections. Sidebar shows
position numbers.

**Guided review** — educational annotations for learning a new language,
this codebase, or programming concepts. Topics include "Programming,"
"This codebase," and 28+ languages. Runs independently of risk/narrative
and, when enabled, also adjusts their output to be more educational.

Processing: batches sized to model context windows (~3 chars/token
heuristic), multi-turn context loops when AI requests more context,
progress tracking (completed/total), binary files excluded (score 0).
Switching between risk and narrative cancels the other. Analyses are
cached for the session; users can invalidate. Unchanged files carry
scores forward across runs.

**API keys** resolve env → keychain → config. Keychains: macOS Keychain,
Linux GNOME/KDE via `secret-tool`, Windows Credential Manager. Config
keys are base64-encoded (not plaintext). Env keys detected and shown
read-only. Privacy: keys never leave the machine except in direct API
calls; code diffs sent are limited to minimum needed. Failures are
reported; parse errors are handled gracefully.

## 9. User interface (`8-user-interface.md`) — **Shipped**

Layout: sidebar + main diff pane, sidebar resizable via drag handle. The
sidebar contains repo name, review mode, file filter, sort-mode
segmented control, file list, and action buttons (Complete Review,
Review History). Diff header has a "Reveal in Finder" button.

Navigation: collapsible folder tree; type-to-filter; `j`/`k` between
files; click to load. Annotation-count and stale-count badges per file.

Sort modes: **Folder** (alphabetical), **Risk** (AI-sorted with badges),
**Narrative** (AI-sorted with positions). Switching to an AI mode without
a configured key prompts the settings dialog.

Progress bar shows reviewed/total; summary line shows "X of Y files
reviewed, Z annotations."

**Settings dialog** via gear icon. Close via X, outside-click, or Esc.
**All settings auto-save on change — no Save/Cancel buttons.** Tabs
(icon + label): General (theme; plus app-name input in Tauri), Profile
(experience-level tags and language-familiarity tags for AI-tailored
explanations), Experimental (AI platform/model/key, guided review
toggle), Updates (Tauri-only).

Keyboard shortcuts: `Cmd/Ctrl+Enter` saves annotation form; `Escape`
closes modals/forms; `j`/`k` navigates files; `Cmd/Ctrl+F` opens find;
`Cmd/Ctrl+Click` on a symbol goes to its definition.

Completion modal confirms Complete Review and offers gitignore add.

Rendering NFRs: server-rendered HTML + client JS; custom JSX runtime for
all HTML generation (server and client); client DOM via `toElement()`,
never `document.createElement()`; auto-escape strings (`raw()` for
pre-escaped). Light + dark color schemes via the theme system. Minimum
window 800×500.

## 10. Data storage (`9-data-storage.md`) — **Shipped**

PGLite embedded Postgres at `~/.glassbox/data/reviews`. Schema applied
automatically; migrations safe across startups. Six tables (see
`code-summary.md` §6): `reviews`, `review_files`, `annotations`,
`ai_analyses`, `ai_file_scores`, `user_preferences`. Global AI config in
`~/.glassbox/config.json` (0600 perms; API keys base64). Project-specific
settings in `<repo>/.glassbox/settings.json` with REST at
`/api/project-settings`. No ORM (raw SQL). IDs: `Date.now().toString(36)
+ Math.random().toString(36).slice(2, 10)`. Reviews isolated by
`repo_path`. Instance lock file (`glassbox.lock`) prevents concurrent DB
access; PGLite handles WASM crash recovery.

## 11. Desktop app (`10-desktop-app.md`) — **Shipped**

Tauri v2 native window wraps the Node server via a sidecar (Node.js
binary + bundled server code). Window title defaults to "Glassbox —
{folder name}" and is configurable via `.glassbox/settings.json`
`appName`. On macOS each project has its own `.app` stub for Dock /
Cmd+Tab identity.

Sidecar is PID-tracked and killed on exit: Unix uses direct kill then
process-group kill; Windows uses `taskkill /T /F`. Three launch flows:
(1) direct app launch with no `--project-dir` shows the CLI-install
welcome screen; (2) macOS CLI (`glassbox`) starts Node in terminal
context (JIT + FS work) and launches a per-project stub `.app`, passing
the server URL via temp file; (3) direct binary with `--project-dir`
spawns the sidecar and navigates on stdout readiness.

CLI install locations: macOS `/usr/local/bin/glassbox` (symlink, admin
prompt); Linux `~/.local/bin/glassbox` (symlink); Windows
`%LOCALAPPDATA%\Programs\glassbox\glassbox.cmd` (copy + user PATH).
Manual-install command shown on failure.

Updates: checked every launch via `tauri-plugin-updater`; **not**
auto-installed — surfaced as a banner with an "Install Update" button,
plus a "Check for Updates" button in Settings. Cryptographically
verified against an embedded public key; served from GitHub Releases.

macOS entitlements declare JIT, unsigned-executable-memory, and
library-validation bypass (required for PGLite WASM under Hardened
Runtime).

Platform targets: macOS (Apple Silicon + Intel), Linux x86_64, Windows
x86_64. macOS builds are signed and notarized. CI builds all artifacts on
`v*` tag push. The CLI symlink points into the installed app bundle so
updates automatically update the CLI with no re-install.

**Active testing is macOS-only.** Linux and Windows builds are produced
by the same pipeline and intended to work, but are not regularly
exercised by the maintainers. `README.md` calls this out explicitly and
invites external contributors to test, file issues, and submit fixes for
those platforms.

## 12. Build and distribution (`11-build-and-distribution.md`) — **Shipped**

`npm i -g glassbox` ships a single-file server bundle (`dist/cli.js`)
with a Node shebang. Requires Node 20+ and git. Desktop builds via
`npm run tauri:build` produce `.dmg` (macOS), `.AppImage` + `.deb`
(Linux), `.msi` + `.exe` (Windows). Build pipeline downloads Node v20
for the target and bundles it as a sidecar; sidecar stubs (< 1 MB)
are detected and rejected in production.

Versions are synchronized across `package.json`, `tauri.conf.json`, and
`Cargo.toml` by the release script. npm installs check for updates once
per day against the registry with 5s timeout; the suggested upgrade
command matches the detected package manager (npm/yarn/pnpm/bun).

Build pipeline: server is ESM via tsup (externals listed in
`code-summary.md` §14); client is an IIFE via esbuild (es2020, minified);
SCSS compiled separately via sass. Both builds use `jsxImportSource: 'kerfjs'`.
CI/CD (GitHub Actions on `v*`) signs/notarizes macOS, produces all
artifacts + `latest.json` for updater, publishes draft Releases.

Dev: `npm run dev` (tsx), `npm run tauri:dev` (both). A sidecar stub
script is created so Tauri's build system doesn't require the real Node
binary in dev.

## 13. Demo mode (`12-demo-mode.md`) — **Shipped**

`--demo:N` launches pre-configured scenarios. Five scenarios:
(1) main UI with guided review notes, (2) risk mode with inline risk
notes, (3) narrative mode with walkthrough notes, (4) annotations with
different categories, (5) settings dialog with guided review. Invalid IDs
error with a list of available scenarios. Demo mode bypasses git
detection and instance locking; demo data is self-contained and does not
affect real reviews.

## 14. Navigation (`13-navigation.md`) — **Shipped**

**Go-to-definition** (`Cmd+Click` / `Ctrl+Click`): searches via the
regex-based outline parser — current file first, then other review
files, then all tracked files. Same-file scrolls with highlight
animation; other review files switch + scroll; repo files outside the
review open as read-only (`/file-raw`) and don't appear in the sidebar.
Common keywords (if/for/return/function/class/etc.) don't trigger.
Unknown symbols get a toast. Cursor turns to pointer when Cmd/Ctrl is
held over code spans.

**Navigation stack**: tracks file visits and scroll positions; scroll
updates the current entry (debounced) instead of pushing new ones; any
file switch pushes a new entry and clears forward history (scrolling
does not). Back/forward buttons sit in a bar above the diff container
with the current file path; disabled when no history. Shortcuts:
`Cmd+[` / `Cmd+]` (macOS), `Alt+Left` / `Alt+Right`
(Windows/Linux). Position restored on back/forward. Stack is in-memory
only.

## 15. Security (`14-security.md`) — **Shipped**

Server binds exclusively to `127.0.0.1`; Tauri connects via `localhost`.
No TLS (loopback only). No authentication (threat model trusts the local
machine).

All API endpoints validate request bodies, query params, and path
params at runtime — TypeScript types alone are not sufficient. Numeric
params checked for NaN; required string params for presence; path IDs
for non-empty. Validation failures return HTTP 400 with descriptive
messages.

**Command execution**: no `exec`/`execSync` with string interpolation;
use `spawnSync`/`execFileSync` with argv arrays. File paths, git refs,
and user values are never interpolated into shell strings.

**API key storage**: keychain preferred; fallback is
`~/.glassbox/config.json` with base64 + 0600 perms. Keys never logged,
never in errors, never in API responses. Error bodies avoid leaking
internal paths/stack traces/system details.

## 16. Themes (`15-themes.md`) — **Shipped**

CSS-custom-property-based theming applied instantly to
`document.documentElement`. Active theme persists in
`~/.glassbox/config.json`. Sixteen built-in themes (Dark default; Light;
High Contrast Dark/Light; Dracula; Tokyo Night; One Dark Pro;
Solarized Dark/Light; Monokai; Nord; Gruvbox Dark/Light; GitHub Dark;
Rosé Pine; Ayu Dark). Built-ins are not editable/deletable.

Custom themes live in `~/.glassbox/themes/{id}.json` with `id`, `name`,
`baseTheme`, and complete `colors` map. Attempting to edit a built-in
auto-copies it to `"<original> (Customized)"`, applies the edit, and
switches active — seamlessly.

Variable groups: backgrounds (bg, bg-surface, bg-hover, bg-active),
text (text, text-dim, text-bright), accent (accent, accent-hover),
semantic (green, red, yellow, orange, blue, purple, teal), border,
diff (add/remove bg + border), gutter (bg + text). No font
customization.

Settings → General has the dropdown + **Manage Themes**. Theme manager
shows name, built-in/custom badge, swatches; actions: Duplicate (all),
Edit (auto-copy built-ins), Rename/Delete (custom only). Theme editor
groups colors by category with label + swatch + native color picker +
editable hex/rgba; live apply; auto-save on close; per-color Reset and
Reset All. NFRs: instant switching, non-blocking I/O, WCAG AAA contrast
for high-contrast themes, browser/Tauri parity, runtime-only (SCSS
build is not affected).

## 17. Share prompt (`16-share-prompt.md`) — **Shipped**

Non-modal banner appears when cumulative open time ≥ 5 min **and**
current session ≥ 1 min. Cumulative time tracked in
`~/.glassbox/config.json`. Offers "Share" and dismiss; after any
interaction, silenced 30 days. Share uses `navigator.share()` with
`https://www.npmjs.com/package/glassbox`; falls back to clipboard copy
with a toast.

A permanent share button sits in the sidebar header toolbar between
refresh and the settings gear. Icon: Lucide "share" on Apple platforms,
"share-2" elsewhere. Dismiss state stored under `sharePrompt` in config
(`dismissedAt`, `totalOpenMs`). Non-intrusive by design; never appears
in demo mode.

## 18. Claude channel (`17-claude-channel.md`) — **Shipped**

`src/channel.ts` is the MCP channel server, spawned by Claude Code via
`.mcp.json` (`glassbox-channel`). Communicates over stdio with MCP;
exposes local HTTP endpoints: `POST /trigger`, `GET /health`. Writes
port to `.glassbox/channel-port` on startup and cleans it up on exit.

Settings > Experimental has the toggle. Enabling registers the entry in
`.mcp.json` and shows the `claude` launch instruction with a Copy
button; disabling removes the entry. State in `~/.glassbox/config.json`
`channelEnabled`. Before enabling, Glassbox checks Claude Code is
installed and ≥ **v2.1.80**. The UI shows connected/disconnected via
periodic health checks in the settings dialog.

When a review is completed and the channel is enabled + connected, the
completion modal adds a **Send to Claude** button that triggers the
channel with `Read .glassbox/latest-review.md and apply the feedback.`
(or the archive path for non-current reviews). On send, the button
briefly shows "Sent!" before the modal closes. If not enabled, the
button is absent and the copyable text remains as fallback.

Endpoints: `GET /api/channel/status` → `{enabled, connected}`;
`POST /enable` / `POST /disable`; `POST /trigger`;
`GET /claude-check` → `{installed, version, meetsMinimum}`. Channel
server binds to `127.0.0.1`; events carry no data beyond the review file
path; server only starts when explicitly enabled. All core review
functionality works regardless of channel state.

## 19. Implementation-status snapshot

Every current requirements doc (1–17) is **Shipped**: review workflow,
CLI/server, git integration, diff viewing, annotations, export, AI
analysis, UI, data storage, desktop app, build/distribution, demo mode,
navigation, security, themes, share prompt, Claude channel. No
design-only or deferred documents at present. When a new feature is
spec'd before implementation, add a doc and mark the entry here
**Design only** until the code lands.

## 20. Maintenance rules

Update `docs/ai/requirements-summary.md` in the same pass whenever you:

1. **Add a new requirements doc** under `docs/`. Insert its section in
   numeric order and link it from §21.
2. **Change a feature's status** (Shipped ↔ Partially built ↔ Design
   only ↔ Deferred).
3. **Supersede or defer** a doc. Keep the section and mark the status,
   noting the replacement.
4. **Materially change the functional / non-functional content** of an
   existing doc (new requirements, changed limits or defaults).
5. **Renumber** docs. Update every reference in this file and in
   `CLAUDE.md`'s requirements index.

Also keep `CLAUDE.md`'s requirements index in sync with `docs/`.

## 21. Related reading

- `docs/1-review-workflow.md` → §2
- `docs/2-cli-and-server.md` → §3
- `docs/3-git-integration.md` → §4
- `docs/4-diff-viewing.md` → §5
- `docs/5-annotations.md` → §6
- `docs/6-export.md` → §7
- `docs/7-ai-analysis.md` → §8
- `docs/8-user-interface.md` → §9
- `docs/9-data-storage.md` → §10
- `docs/10-desktop-app.md` → §11
- `docs/11-build-and-distribution.md` → §12
- `docs/12-demo-mode.md` → §13
- `docs/13-navigation.md` → §14
- `docs/14-security.md` → §15
- `docs/15-themes.md` → §16
- `docs/16-share-prompt.md` → §17
- `docs/17-claude-channel.md` → §18
- `docs/ARCHITECTURE.md` — system-level architecture narrative
- `docs/tauri-architecture.md` — Tauri sidecar deep dive
- `docs/tauri-setup.md` — signing / certificates / GitHub secrets
- `docs/ai/code-summary.md` — the companion code map
- `CLAUDE.md` — project rules and conventions
