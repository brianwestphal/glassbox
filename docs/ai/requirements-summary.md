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
- **kerfjs JSX runtime**, not React. HTML is rendered server-side for
  initial load; client-side reactivity via `mount()` / `delegate()` /
  `signal()` / `defineStore`.
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
only. **SVGs** get a Code/Rendered toggle; Rendered renders the SVG **live
in the browser** (GB-932) — the image route serves raw `image/svg+xml` into
a native `<img>`, so animated SVGs animate and text uses the browser's font
stack, and the same difference/slice/metadata modes apply. A font-caveat
banner appears when the SVG uses text/`font-family`/`@font-face` (external
font URLs don't load in an `<img>`). This replaced the prior server-side
`@resvg/resvg-wasm` rasterizer + worker thread, which flattened animations
and could take tens of seconds on large SVGs; that dependency was removed.
`parseSvgDimensions`/`svgUsesExternalFonts` (`src/git/svg-meta.ts`) supply
the actual-size target + caveat. The user's Code/Rendered choice is
remembered across files.

**Side-by-side comparison** (doc 24, Shipped): a **Side by Side** mode shows
old (A) and new (B) in two panes and is the **default** mode for a two-sided
image (or rendered-SVG) change. A single sub-option — shown only while
side-by-side is active — flips the panes between **left/right** (default) and
**over/under** (`data-sxs-orientation` on the panel drives the CSS flow);
the choice persists as the `image_sxs_orientation` user preference. Zoom/pan is
synchronized across the two panes (reusing the shared zoom state), each pane is
sized to its own image (differently-sized A/B aren't distorted), and doc-23
drawn-region feedback works per pane (A-only on the A pane, B-only on the B
pane, unscoped on both). Layout-only — no new server route. Client wiring:
`adaptImageToolbar`/`setupImageModeEffect` in `src/client/diff/index.tsx`,
panes + per-pane sizing in `src/client/diff/imageDiff/index.ts`.

**Feedback attachments** (doc 25, P1 shipped): a reviewer can attach any file
type to a feedback item via an **attach button** or **drag-and-drop**; the files
render as **chips** beneath the comment and persist with the review (hydrated
from the server on reload). Selecting a chip and pressing **Space** (or clicking)
opens it in the OS preview — macOS **Quick Look** (`qlmanage -p`), default opener
on Windows/Linux — launched by the always-local Node server shelling out (the
`'quicklook'` mode of `openOS`, same path as "reveal in file manager"). Bytes
live under `<dataDir>/attachments/` with an `attachments` table; the markdown
export lists each attachment's **absolute path** under its annotation so the AI
tool can read it. Images show a chip **thumbnail** and open an **in-app preview
overlay** (lightbox) on click/Space; other types open in the OS default app.
**Paste-to-attach** works while a feedback item is focused. The attachment bar is
wired on **line annotations**, **note replies** (same `AnnotationItem`), and
**image-feedback** comments/regions. Client:
`src/client/annotations/attachments.tsx`; routes `src/routes/api/attachments.ts`.
Related (GB-953): clicking an AI review note's **image artifact** (doc 20) opens
a shared full-screen **lightbox** (`src/client/lightbox.tsx`) where the reviewer
**drags a rectangle**; the region rides into the reply they write and renders as
a marked thumbnail (`src/components/reviewNoteRegionThumb.tsx`), reusing doc 23's
normalized `{x,y,w,h}` model with an `artifact` uri in `region_data`.

**Image feedback** (doc 23): a panel below the image canvas lets the
reviewer add general comments about an image and draw rectangle regions
(stored as normalized `{x,y,w,h}` fractions) that show on both A/B sides
across the comparison modes, each region carrying a comment. Persisted as
image-level annotations (`line_number 0` + a `region_data` JSON column,
reusing the annotations table) and folded into the markdown export as
`Image comment` / `Image region (x%, y%, w%×h%)`. A second pass added:
reviewer-selectable **category** per comment/region (shared annotation
picker); **per-side scope** — a region can apply to A-only, B-only, or both,
stored as an optional `side` inside `region_data`, shown as an `A+B`/`A`/`B`
badge + box tint + export qualifier; **hover-linking** a list row to its box;
and **move/resize** of an existing box (drag interior to move, edges/corners to
resize), persisted via `PATCH /annotations/:id/region`. Drawing while
zoomed/panned lands the box where drawn (overlay-relative coord math). Client:
`src/client/diff/imageDiff/imageFeedback.tsx` + pure `regionGeometry.ts`
(now also `hitTestRegion` / `resizeRegion` / `moveRegion`).

Other controls: wrap toggle, ignore-whitespace toggle (regenerates with
`-w`, persisted in user_preferences), syntax highlighting (auto-detected
or user-selected; NFR: a pathologically long line — minified/base64/single-line-SVG
blob — is truncated for display server-side (bounded prefix + a `.line-truncated`
marker) so the DOM never holds a multi-hundred-KB text node whose layout/paint
freezes the main thread, and such lines are also left unhighlighted; the freeze is
worst in the desktop WKWebView and is invisible to headless timing tests, so the
regression guard asserts bounded rendered content, not a time budget),
context expansion (live from working tree), symbol
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

**Model discovery** is **live** (GB-894): when a platform's key is
configured, `src/ai/list-models.ts` fetches the current model list from
the provider's models API (Anthropic `/v1/models`, OpenAI `/v1/models`
filtered to chat models, Google `/v1beta/models` filtered to
`generateContent`), zod-validated and mapped to `{id,name,contextWindow}`;
the static `src/ai/models.ts` list is the fallback (no key / failure /
demo / `--ai-service-test`). Because providers return only
currently-available models, retired ids never appear. A stale/older saved
model id is best-effort resolved to the current same-tier model
(`resolveModelId` — e.g. `claude-sonnet-4-5` → `claude-sonnet-4-6`) so it
never 404s (GB-893).

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
Review History). Diff header has a "Reveal in Finder" button. The nav bar
has a hide/show **sidebar toggle** (panel icon, before the back/forward
arrows; per-session, not persisted across reload — GB-955).

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

Rendering NFRs: server-rendered HTML + client JS; kerfjs JSX runtime for
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

External links (e.g. the Sponsor link) open in the OS default browser.
Inside the webview `target="_blank"` reaches no real browser, so when the
Tauri runtime is detected the client routes the click to the local
`POST /api/open-external` endpoint (http/https only), which opens the URL
via the same OS-open mechanism as file reveal; a plain-browser CLI launch
keeps the anchor's native `target="_blank"` behavior.

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

Release notes are AI-drafted by `scripts/release.sh`, which delegates to
[`gitgist`](https://github.com/brianwestphal/gitgist) (a `devDependency`,
run from `node_modules/.bin/gitgist` or a global install), then opens the
draft in `$EDITOR` for review. gitgist owns the prompt, provider selection
(its `auto` backend reuses the signed-in `claude` CLI → `ANTHROPIC_API_KEY`
→ on-device Apple FM), code-fence stripping, and noise filtering. The
release script only chooses the comparison base — stable diffs against the
last **production** tag (excluding `*-rc.*` / `*-beta.*`), beta against the
immediately-previous tag — and passes it as a `<base>..HEAD` range; gitgist
scales detail to the volume of work, so no separate beta/stable prompt is
needed. A failed/unavailable draft is detected by gitgist's **exit code**
(not stdout sniffing) and the empty-range `_No changes…_` placeholder is
treated as no draft; both fall back to a blank editor. Editor guidance
lines prefixed with `#` are stripped on save; resumed runs reuse saved
notes instead of redrafting. `npm run commit:msg` drafts a Conventional
Commit message from the staged diff via `gitgist --staged --commit-message`.

Build pipeline: server is ESM via tsup (externals listed in
`code-summary.md` §14); client is an IIFE via esbuild (es2020, minified);
SCSS compiled separately via sass. Both builds use `jsxImportSource: 'kerfjs'`.
CI/CD (GitHub Actions on `v*`) signs/notarizes macOS, produces all
artifacts + `latest.json` for updater, publishes draft Releases.

Three tag-driven workflows: `release-candidate.yml` (v*-rc.* → full
validate → npm@beta → smoke → promote → desktop), `release-beta.yml`
(v*-beta.* → opt-in pre-release; npm `--tag beta` + GH prerelease; no
auto-promote — `npm run release:beta` triggers this), and
`release-desktop.yml` (stable `v[0-9]*` tags excluding rc/beta). Beta
releases stay invisible to the Tauri updater and the in-CLI upgrade nudge
because both consult `releases/latest` / npm `latest`, which skip
prereleases.

The stable release's GitHub Releases page carries a per-platform
**Download** summary (grouped install links + an `npm install` line) and
renames the macOS `.dmg`s to friendly dash-separated names
(`Glassbox-<version>-macOS-Apple-Silicon.dmg` / `-macOS-Intel.dmg`); only
`.dmg`s are renamed since `latest.json` references the other installers by
their original names. The summary links and the rename rules share one
source of truth (`scripts/release/release-assets.mjs`) so a link can never
404 against a mismatched asset, and the draft→published flip waits for the
rename job (§11.3.2).

Dev: `npm run dev` (tsx), `npm run tauri:dev` (both). A sidecar stub
script is created so Tauri's build system doesn't require the real Node
binary in dev.

## 13. Demo mode (`12-demo-mode.md`) — **Shipped**

`--demo:N` launches pre-configured scenarios. Seven scenarios:
(1) main UI with guided review notes, (2) risk mode with inline risk
notes, (3) narrative mode with walkthrough notes, (4) annotations with
different categories, (5) settings dialog with guided review, (6) direct
comparison (`--diff`) of two folders — a fabricated `compare: A ↔ B`
review for screenshotting doc 18's CLI mode, (7) AI review notes inline
with the diff — `session.ts`'s illustrative `demoReviewNotes` set
(rationale / proof / risk / outdated) plus the threaded human reply, for
screenshotting doc 20's render. Invalid IDs error with a
list of available scenarios. Demo mode bypasses git detection and
instance locking; demo data is self-contained and does not affect real
reviews.

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

A single, non-modal "Love Glassbox?" section appears in the sidebar footer
(`#sidebar-share`) once cumulative open time ≥ 5 min **and** current
session ≥ 1 min (time-gated — never shown immediately on launch).
Cumulative time tracked in `~/.glassbox/config.json`. It offers a
**Share** button and a **Sponsor** link (GitHub Sponsors; routed through
the OS browser under Tauri), plus a **×** dismiss; sharing or dismissing
silences it for 30 days. Share uses `navigator.share()` with
`https://www.npmjs.com/package/glassbox`, falling back to clipboard copy
with a toast.

Permanent share access (independent of the time-gated prompt) is the
**Settings → General** share link ("Know someone who'd love this? Share
Glassbox", always available, never dismissed). The originally-spec'd
permanent *toolbar* button (between refresh and the settings gear,
platform-specific Lucide "share"/"share-2" icons) was **never built and
was intentionally dropped** as redundant with the Settings link; the
`IconShareApple`/`IconShareGeneric` icons in `src/icons.tsx` are the
unused leftovers. Dismiss state stored under `sharePrompt` in config
(`dismissedAt`, `totalOpenMs`). Non-intrusive by design; never appears in
demo mode. (GB-890 consolidated an earlier second, immediate-on-launch
banner into this one time-gated section.)

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

## 18a. Direct path comparison (`18-direct-comparison.md`) — **Shipped**

Diffing **two arbitrary files or two arbitrary folders** named by path
(`glassbox --diff <A> <B>`), independent of git history and usable
**outside any git repository**. The diff is produced by
`git diff --no-index <A> <B>` (the same primitive `--all` uses), so it
needs the `git` binary but no repo. `A` is the old side, `B` the new.

Files must be the same kind (file/file or folder/folder); folder
comparison recurses and pairs files by relative path (added / deleted /
modified), with **no `.gitignore` filtering** by default. Image/SVG and
binary diffs read each side from disk rather than from git refs; hunk
context expansion reads from the new-side path. The review record uses
`repo_path` = cwd, a `"A ↔ B"` label for `repo_name`, and `head_commit`
= null; the markdown export lands under the cwd's `.glassbox/`. Features
that assume a repo (go-to-definition repo scan, Claude channel, gitignore
prompt) degrade gracefully; AI analysis works normally.

**Shipped** — CLI + diff engine + context expansion + image/SVG disk
reads landed together as a single coherent change (the `ReviewMode`
switches are exhaustive). FR-18.11 was explicitly resolved as
**CLI-only**: a desktop in-app file/folder picker was considered and
deferred — the CLI entry point covers the workflow.

## 18b. Git difftool integration (`19-difftool-integration.md`) — **Shipped**

Using Glassbox as a registered **`git difftool`** via the `glassbox-difftool`
companion binary. Registration (`--register-difftool` / Settings → General) and
`--dir-diff` (whole change set in one review) already work; this doc specifies
the **per-file** experience.

Per git's per-file model, git invokes the tool once per changed file and waits
for each to exit before the next — historically causing browser-mode hangs.
The spec replaces that with a **thin-client wrapper + single accumulating
server** (Kaleidoscope model): each invocation reads the `$LOCAL`/`$REMOTE`
content (before git deletes the temp files), finds-or-starts one detached
server, appends the file to a single live review, and exits — so git advances
and all files land in **one** tab/window. git exposes
`GIT_DIFF_PATH_COUNTER`/`GIT_DIFF_PATH_TOTAL`, so the wrapper detects the **last**
file and **holds** the `git difftool` command open until the user clicks
**"Done"** (clean exit) or presses **Ctrl-C** (fallback); the held connection
bounds the server's lifetime, so nothing is orphaned. Browser tab-close and
desktop window-close are equivalent end signals. A new typed append endpoint
takes raw old/new content; the sidebar grows as files arrive. Singleton server
(concurrent runs merge, by design); `--dir-diff` stays a supported optimization.

**Shipped** — the accumulating model is shipped for both **browser** and
**desktop**: the thin-client wrapper (`src/cli-difftool.ts` +
`src/git/difftool-client.ts`), the detached accumulating server (`glassbox
--difftool-serve`), the typed append/poll/hold/end API
(`src/routes/difftool-api.ts`, `src/difftool/session.ts`), the live sidebar +
"Done" affordance, registration, and `$MERGED` repo-relative labeling. Per-file
desktop accumulates into one Tauri window (FR-19.9): the wrapper launches the
launcher shim in `--difftool-serve` mode and later invocations append to the
running session; closing the window kills the sidecar and ends the session
(`src-tauri/src/lib.rs`). Image/SVG visual comparison works too: the append
endpoint persists each binary/SVG file's raw bytes to an on-disk blob store
(`src/git/image-blobs.ts`, under the session data dir, cleared on teardown)
and the `/image` route reads from there for a difftool review (GB-863). Internal
git subprocesses run with `git difftool`'s leaked `GIT_EXTERNAL_DIFF` /
`GIT_DIFF_PATH_*` scrubbed (`scrubbedGitEnv()` in `src/git/repo.ts`) so Glassbox's
own `git diff`/`git show` can't recurse into the difftool helper (NFR-19.12,
GB-869). Covers FR-19.1–19.13.

## 18c. AI-authored review notes (`20-ai-review-notes.md`) — **Partially built (P1)**

A line-anchored "review companion" the *generating* AI emits as it writes code:
structured notes explaining why each non-obvious change is the way it is and what
proves it correct, anchored to file + line range, so a reviewer reads the
author's reasoning at the exact line instead of reconstructing it from a ticket
or commit message. Notes are stored as committed **SARIF 2.1.0** files in a
dedicated top-level **`.pr-notes/`** directory (deliberately *not* under
`.glassbox/`, which users commonly gitignore; the tool must never auto-ignore
`.pr-notes/`). SARIF is reused rather than invented for its region anchoring,
`partialFingerprints` (re-anchoring across edits — reuses Glassbox's existing
stale-matcher), `versionControlProvenance` (baseline commit), attachments, and
broad tooling support; positive rationale/proof is modeled via
`result.kind: informational` plus property bags, with the caveat that
third-party SARIF viewers won't render it as a review companion (Glassbox builds
that view). Authoring is live-plus-coalesce: the AI emits notes via an MCP
channel tool as it edits, revises them, then runs a final consolidation pass to
cut verbosity and surface cross-cutting links. Artifacts split by type — diagram
*source* (Mermaid/Graphviz/PlantUML), logs, and test output commit as text;
screenshots go through **Git LFS** under `.pr-notes/artifacts/`, referenced by
uri + sha-256, never inlined — keeping repo history lean. Glassbox renders notes
review-comment-style in the diff, styled distinctly as AI-authored (guided-review
precedent), with threading and artifact rendering. A corresponding Hot Sheet (and
other-orchestrator) obligation induces the AI to produce notes as part of its
process. Phased P1–P5 plus a cross-cutting inbound AI-instructions contract.
**P1 is shipped**: the `.pr-notes/` SARIF profile (`src/review-notes/`)
and the producer-side **`glassbox note` CLI** writer (Glassbox isn't
running while the AI codes, so authoring is producer-side — CLI or the
written spec — not a live MCP tool). Layout is path-sharded
(`.pr-notes/notes/<src path>.NNNNNN.sarif`, 10k-results-per-shard cap);
the mapping is standard SARIF (kind→`tags`, ticket→`workItemUris`,
producer→`tool.driver`, anchor→`region`+snippet, durability→
`partialFingerprints`) with exactly one custom field,
`ext-ai-tool-confidence`. The CLI does `add` / `update` / `remove` (by
note guid) / `coalesce` (mechanical dedup of identical notes) /
`instructions` (prints the canonical **inbound** AI-instructions contract
— `src/review-notes/instructions.ts` — for orchestrators to inject, so
wording never forks from the CLI). **P2 (reader + render) shipped**:
`loadReviewNotesForFile` flattens `.pr-notes/` SARIF into diff-anchored
views (`view.ts`), and `DiffView` server-renders them full-width below
their line (flow-broken like annotations so split columns stay aligned),
styled distinctly as AI-authored with a per-kind badge. **P3 (re-anchor)
shipped**: `reanchorReviewNotes` re-matches each note's authored snippet
against the current diff at load (moves shifted notes, flags vanished
ones stale with an "outdated" badge). **P5 (analysis-feed) shipped**:
`format.ts` folds notes into the analysis prompt (an "Author review
notes" section in `runAnalysisBatch`, informing risk/narrative/guided)
and into the `latest-review.md` export. **Threading shipped**: a reviewer
can Reply to a note (the row carries its `guid` + a Reply button); the
reply is a human annotation linked by a nullable `reply_to_note_id`
column, tagged "↳ reply". **Stale keep/discard shipped**: an outdated
note offers Keep (dismiss the flag) / Discard (`DELETE
/api/review-notes/:guid` → `removeNote`). **Reply nesting shipped**:
replies render nested directly beneath their note (orphans fall back to
line rendering). **Markdown bodies shipped**: note bodies (review notes +
the risk/narrative/guided AI notes) render via a safe, escape-first inline
renderer (`src/utils/noteMarkdown.ts` — code/bold/italic/links, scheme-
gated). **P4 foundation shipped**: notes attach artifacts (`glassbox note
add --artifact` → SARIF `result.attachments`) and text/diagram-source
artifacts render as inline collapsible code blocks, **image artifacts as
`<img>`** served by a path-contained `GET /api/review-notes/artifact`
route, with **sha-256 hashes + Git LFS `.gitattributes`** wiring on the
writer. The **AI-driven cross-cutting *linking*** half of coalescing
shipped as **producer-side guidance** in the inbound instructions contract
(a "Final consolidation pass" the generating AI runs after `coalesce`,
merging near-duplicates via `update`/`remove` and linking related notes via
shared `--ticket` + inline "see also" body references) — no Glassbox link
primitive is built until a driver emits structured links. Remaining: the
one P4 follow-up — **live diagram rendering** (Mermaid/Graphviz/PlantUML)
into actual diagrams.

## 18d. Sidebar context menu (`21-sidebar-context-menu.md`) — **Shipped**

Right-clicking a sidebar file row opens a custom (themeable, viewport-clamped)
context menu anchored at the cursor, suppressing the native menu. It works across
all sort modes (every `.file-item` carries `data-file-id`; one delegated
`contextmenu` handler in `src/client/sidebar/contextMenu.tsx`, with pure label
logic split into `contextMenuLabels.ts`). Each item has a Lucide icon. Actions:
**Reveal** in the OS file manager (`POST /files/:id/reveal` → `openOS(…,
'reveal')`; platform-aware label — Finder / File Explorer / containing folder);
**Copy Path** (modifier-aware like Finder — absolute by default, repo-relative
when Option/Alt is held, with a live-updating label; absolute resolves via `GET
/files/:id/path`); **Mark reviewed/pending** (`PATCH /files/:id/status`, reactive
status dot + progress); and **Open in Default Editor** (`POST /files/:id/open` →
`openOS(…, 'edit')` = OS default-open `open`/`start`/`xdg-open`; deliberately
ignores `$EDITOR`/`$VISUAL` since terminal editors spawned detached silently
no-op — GB-892). All server actions are best-effort (failures swallowed,
`--debug`-logged). The menu dismisses on item-select, Escape, outside
click/right-click, scroll, or blur.

## 18e. Local & on-device AI models (`22-local-and-on-device-models.md`) — **Built (local + Apple FM with secondary fallback)**

Extends AI analysis beyond the three cloud providers to **`local`**
(OpenAI-compatible servers — Ollama default `http://localhost:11434/v1`, LM
Studio, etc.) and **`apple`** (Apple Foundation Models, on-device, macOS 26+),
as two new `AIPlatform` members plugging into the same `sendAIRequest` switch /
config / discovery / settings abstraction. Local reuses the OpenAI
`/chat/completions` request + `/models` discovery with a configurable base URL
and no required key; Apple delegates to the [`apple-fm`](https://github.com/brianwestphal/apple-fm)
package — a Node library over its own bundled, signed + notarized
`FoundationModels` helper (macOS-only). Phasing: **P1** local
**(shipped)** — `KEYLESS_PLATFORMS`/`sendLocalRequest`/`resolveLocalEndpoint`/
`fetchAvailableModels('local')` + the settings server-URL input; **P2** Apple FM
**(shipped)** — the `apple` keyless platform, the Node bridge
(`src/ai/apple-foundation.ts`, a thin wrapper over `apple-fm`'s `probe`/`generate`,
mocked-`apple-fm` unit tests), the client `sendAppleRequest` case
(`{system,messages}`→text), and the settings UI (Apple shown only when the probe
passes; no key/endpoint). **P2a (signing/notarization) shipped via the `apple-fm`
migration** — `apple-fm` ships its helper already Developer-ID signed + hardened
+ independently notarized, so Glassbox no longer compiles, signs, or notarizes a
Swift helper and the **dedicated `macos-26` CI job + signing-keychain script are
removed**. `build-sidecar.sh` copies the `apple-fm` package (helper included) into
the sidecar like any external dep; the embedded signature survives so
`tauri-action`'s notarization of the whole bundle covers it (codesign needs no
macOS-26 SDK, so the bundle build stays on `macos-latest`). The launcher points
`APPLE_FM_BIN` at the bundled helper; a guarded re-sign in `build-sidecar.sh`
keeps the signature self-consistent when an identity is present. Non-arm64 /
non-macOS bundles hide the Apple platform via the probe (`unsupportedPlatform`).
Remaining: the maintainer's clean-machine macOS-26 smoke test (the one off-CI,
on-device verification), validated via a beta cut first.
**Apple FM's 4096-token window (shared input+output) can't fit the risk-analysis
prompt + verbose JSON output for larger diffs** — it overflows
non-deterministically (`exceededContextWindowSize`), and the ceiling isn't
removable by prompt trimming (the model must see the whole file). So selecting
`apple` lets the user pick a **secondary non-Apple fallback model**
(`fallbackPlatform`/`fallbackModel` → nested `AIConfig.fallback` via
`loadAIConfig`): `runAnalysisBatch` runs each batch on-device and retries any
**failed batch** once with the fallback (rebuilding contexts against its larger
window). Trade-off: a review may then mix two models' scores — accepted to keep
on-device coverage. `APPLE_FM_ANALYSIS_ENABLED` is the platform kill-switch; the
fallback config + execution are unit/integration-tested while the on-device path
stays CI-unverifiable (doc 22 §22.10).

## 19. Implementation-status snapshot

Every requirements doc 1–18 is **Shipped**: review workflow,
CLI/server, git integration, diff viewing, annotations, export, AI
analysis, UI, data storage, desktop app, build/distribution, demo mode,
navigation, security, themes, share prompt, Claude channel, direct path
comparison. Doc **19** (git difftool integration) is **Shipped** — the
accumulating per-file model works for both browser and desktop, plus in-session
image/SVG comparison (GB-863). Doc **20** (AI-authored review notes) is
**Partially built** — P1 shipped (the `.pr-notes/` SARIF format + the
`glassbox note` producer CLI); reader/render and later phases remain. Doc
**21** (sidebar context menu)
is **Shipped** — right-click a file to reveal it in the OS file manager. When a
new feature is spec'd before implementation, add a doc and mark the entry here
**Design only** until the code lands, then **Partially built** / **Shipped** as
it progresses.

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
- `docs/18-direct-comparison.md` → §18a
- `docs/19-difftool-integration.md` → §18b
- `docs/20-ai-review-notes.md` → §18c
- `docs/21-sidebar-context-menu.md` → §18d
- `docs/22-local-and-on-device-models.md` → §18e
- `docs/ARCHITECTURE.md` — system-level architecture narrative
- `docs/tauri-architecture.md` — Tauri sidecar deep dive
- `docs/tauri-setup.md` — signing / certificates / GitHub secrets
- `docs/ai/code-summary.md` — the companion code map
- `CLAUDE.md` — project rules and conventions
