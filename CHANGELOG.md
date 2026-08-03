# Changelog

All notable changes to Glassbox are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.1.0] - 2026-08-03



- Automatic PostgreSQL major-version upgrade: databases created by PGLite 0.4.x (PG17) are migrated in place to PG18 on first launch, instead of failing to open. The pre-upgrade cluster is copied, verified, and retained as a fallback.
- Settings → General now lists retained pre-upgrade database backups with size on disk, date taken, and full path, plus Reveal and Delete actions to reclaim the space once the upgrade is trusted.
- Settings → General also lists quarantined unreadable data directories in a "Preserved unreadable data" section, with size, date, path, and a Reveal action (no delete — the data is never destroyed for you).
- Git LFS-tracked images now work: pointer files are detected as binary and their real bytes are fetched through git's filters, so an LFS-tracked PNG shows the image comparison instead of a text diff of `oid sha256:…`.
- AI review notes accept `--related <file:line>` (repeatable), and a note body's embedded links jump straight to the referenced line — in the same file, another review file, or elsewhere in the repo.


- An unopenable database is no longer deleted. Previously any PGLite open failure mentioning "Aborted" or "RuntimeError" was treated as corruption and the data directory was removed, destroying every review and annotation; it is now preserved and quarantined.
- The upgrade now also transfers columns the current schema has since dropped, so a long-lived database carrying a stale column no longer fails the migration and leaves the app unable to start.
- Annotation drag handles are draggable again — the markup emitted an invalid `draggable` value that silently disabled mouse dragging. Note-artifact and lightbox images are correspondingly no longer draggable, which was fighting the drag-to-mark-a-region gesture.
- `glassbox note` rejects unknown flags instead of silently accepting and dropping them, so a typo (or a flag your installed binary predates) no longer exits 0 having written an incomplete note.
- Review-note artifacts that are unresolved LFS pointers return 404 rather than being served as a corrupt image.


- AI review notes and risk/narrative/guided notes render block-level markdown — headings, lists, and paragraphs — instead of collapsing to literal `###`, `**`, and `- ` on one line.
- Note bodies are now written to SARIF correctly: the markdown source in `message.markdown` with a genuine plain-text rendering in `message.text`, so third-party SARIF viewers show prose rather than raw markers. Markdown headings in exported notes are demoted so they can't outrank the export's own structure.
- Mermaid and PlantUML renders are bounded by a wall-clock timeout and fall back to the code block, so a subprocess that never exits can no longer hang the request.

## [1.0.0] - 2026-07-23



- New opt-in content plugin system: install renderers and differs that display specialized file formats (diagrams, custom content) as live visuals instead of raw text diffs
- First-party plugins: **Graphviz** (`.dot`/`.gv`), **PlantUML** (`.puml`, requires local Java), and **Mermaid** (`.mmd`, requires local Chromium) — all render offline via local engines, falling back to a code block when unavailable
- Plugin-rendered files get a **Code | Rendered** toggle: the rendered diagram goes through the full image viewer with zoom, A/B, side-by-side, difference, and slice comparison modes
- New **image-codecs** plugin adds WebP and AVIF decoding so ground-truth comparisons in those formats get perceptual difference scores
- New **Settings → Plugins** tab to view, enable/disable (globally or per project), install, and uninstall plugins — with an "Available to install" section that checks system readiness, auto-provisions what it can, and gives specific setup instructions for the rest
- Plugins can declare user preferences (auto-saved from Settings, with secrets stored in the OS keychain), grouped config layouts with action buttons, interactive UI elements in the app chrome, and review lifecycle hooks
- Desktop: native folder picker for installing a plugin from disk
- AI review notes can carry diagram artifacts rendered inline (e.g. a Mermaid sequence diagram as proof), and `glassbox note instructions` now asks generating AIs to attach them


- Desktop: launching in a repo with no pending changes shows "No changes to review" instead of hanging on the loading screen forever
- Desktop: `glassbox note` and `glassbox ground-truth` subcommands now work from the installed CLI (they previously failed with "Unknown option")
- `--files` now includes brand-new untracked files instead of showing an empty diff
- Fixed AI analysis getting permanently stuck on "running" after a transient failure or server restart; failures now surface with a message and can be retried
- The completion modal no longer freezes on "Completing…" when a request fails — it shows a failure state with retry, and Send to Claude reports failures too
- Deleting a review now also removes its attachment files from disk (previously they were leaked)
- Diagrams rendered from viewBox-only SVGs (e.g. Mermaid output) no longer collapse to an invisible 0×0 image
- The "Draw region" button is hidden in image Metadata mode, where there is nothing to draw on
- A failed image-feedback save now restores your typed text and category instead of silently discarding them
- Form inputs (checkboxes, text fields, selects) keep their state across UI re-renders
- Attachments with non-ASCII filenames download correctly instead of failing
- A hand-edited or malformed theme setting in config.json no longer crashes at startup


- The Claude Code channel trigger endpoint now requires a per-process shared secret and no longer sends permissive CORS headers, blocking malicious browser pages from firing triggers at the local port
- Plugin and theme delete/install routes validate ids against path traversal before touching the filesystem
- Raw file requests are rejected if the path escapes the repository root
- The Google AI API key is sent via header instead of the URL query string, keeping it out of logs and proxies
- Dependency updates clear a high-severity URL-parsing advisory in the server stack


- Refreshed app icon, and the browser tab now shows a favicon
- Consistent toasts and popup menus across the app

## [0.19.0] - 2026-07-02


- Refreshed the app icon and browser favicon with a new gradient cube mark.

- Fixed sidebar and annotation list rendering glitches where a selected row could lose its selection after another row was removed, or items could fail to render correctly when a list was cleared and refilled.

## [0.18.0] - 2026-06-26


- **Ground-truth image comparison** — a new `glassbox --ground-truth <manifest.json>` mode (no git repo required) compares actual images against expected baselines (design specs, reference renders, or previous-actual baselines), with a perceptual difference score that hides identical pairs and sorts the list most-different-first. Supports ordered sets/flows of steps, Expected/Actual pane labels, a named source list, and a `glassbox ground-truth promote` command to rotate baselines.
- **Side-by-side image comparison** — review image changes with old (A) and new (B) shown in two panes, toggling between left/right and over/under layouts; this is now the default for two-sided image and rendered-SVG changes, with synced zoom/pan.
- **Single-side image focus modes (A / B)** — view only the old or only the new image, with per-side region feedback, placed between Metadata and Side by Side in the mode control.
- **Reviewer file attachments** — attach any file (screenshots, logs, specs, recordings, up to 50 MB) to a line comment, image comment, drawn region, or note reply via button, drag-and-drop, or paste. Image chips show inline thumbnails and open a full-screen preview; other types open in the OS default app, and attachment paths ride into the exported review for AI tools.
- **Sidebar hide/show toggle** — a nav-bar button collapses the sidebar so the diff fills the width, and restores it on a second click.
- **Review-note image artifacts** — click an AI review note's image to open a full-screen lightbox; drag a rectangle to mark a region (one or more) that rides into your reply as a "see this spot" thumbnail.
- **Structured review export + completion hook** — Glassbox now also writes `.glassbox/latest-review.json` alongside the markdown, and a new `--on-complete "<cmd>"` hook runs a command when a review completes (with review JSON/markdown/ID/repo paths in the environment), enabling automated review loops.
- **Automatic `.gitignore` management** — at launch inside a git repo, Glassbox keeps `.gitignore` set up to ignore `.glassbox/` contents while keeping the shared per-project `settings.json` tracked.

- Fixed `git difftool` per-file mode misrouting added files into a blocking review instead of accumulating them into one session.
- Fixed a ground-truth review showing a gigantic, useless serialized "source" label in the sidebar.
- Fixed a production-only crash when launching a ground-truth review from the packaged app.
- Side-by-side "Actual size" (1:1) now sizes each pane to its own image instead of only the first pane.
- Fixed unresponsive edit/delete icon-button clicks on image-feedback comments.

- Replaced decorative Unicode glyphs and the artifact emoji throughout the UI with consistent lucide SVG icons.
- Image-file diffs now use the shared lightbox with zoom/pan.

- Added an AI-integration hub (`AGENTS.md` + `docs/ai-integration.md`) documenting how external AI tools launch reviews, write review notes, export proof, and consume feedback.
- Refreshed the README to showcase image diffs, ground-truth comparison, attachments, and the side-by-side image layouts, with re-captured screenshots.

## [0.17.0] - 2026-06-22


- SVGs in the diff "Rendered" view now render live in the browser, so animated SVGs animate and text uses the browser's fonts — replacing the old server-side rasterizer that flattened animations and stalled on large files.
- Zooming an SVG in the rendered view now scales it as a true vector, so it stays crisp at any zoom level instead of looking pixelated.
- Image feedback: add textual comments to images, including comments anchored to rectangular regions you draw, shown on both sides of the diff.
- Image comments and regions can now be assigned any annotation category (bug, fix, style, etc.) instead of always being plain notes, and support per-side scope, hover-linking, and moving/resizing regions.

- macOS trackpad gestures on image and SVG diffs now match native behavior: pinch zooms at the cursor, and a two-finger swipe pans instead of zooming.
- Panning a zoomed SVG is now reliable across browsers, with a cursor that signals the image is draggable.

## [0.16.0] - 2026-06-20


- The Apple Foundation Models (on-device) provider now runs through a signed and notarized helper binary for more reliable on-device analysis on macOS.

## [0.15.0] - 2026-06-20



- **AI Review Notes** — AI tools can now emit line-anchored notes explaining *why* a change was made and what proves it correct, via the new `glassbox note` command. Notes are stored as committed SARIF in `.pr-notes/` and render review-comment-style inline in the diff, distinctly styled as AI-authored.
- **Reply to review notes** — Reply to an AI-authored review note with an annotation; replies render nested beneath the note they answer, turning a note into a threaded conversation.
- **Keep/Discard outdated notes** — Review notes re-anchor to the current diff as code moves; notes whose authored code has changed are flagged "outdated", with Keep (dismiss the flag) and Discard (remove the note) controls.
- **Proof artifacts on notes** — Review notes can carry committed proof artifacts (test output, logs, diagram source, and images), rendered inline beneath the note. Images record a SHA-256 hash and use Git LFS to keep binaries out of history.
- **Notes feed analysis and export** — The generating AI's stated rationale, risks, and assumptions now inform Glassbox's AI analysis and are folded into the markdown export the next AI session reads.
- **Markdown in AI notes** — AI note bodies (review, risk, narrative, and guided) now render a safe markdown subset, so code spans, emphasis, and links display properly.
- **Local AI platform** — Run risk, narrative, and guided analysis against any OpenAI-compatible server (Ollama, LM Studio) — free, offline, and without an API key.
- **Apple Foundation Models** — New on-device AI platform (macOS 26+) that runs analysis locally with no network calls or API key. Because its context window is small, selecting it lets you pick a secondary fallback model that handles diffs too large to fit on-device.
- **More note commands** — `glassbox note` gains `update`, `remove`, and `coalesce` subcommands, plus an `instructions` contract telling a generating AI when and how to emit review notes.


- Keyless AI platforms (Apple and Local) can now run analysis — the analyze endpoint no longer rejects them for having no API key.
- A rejected analysis start (e.g. a keyless 400) now surfaces an error instead of spinning on "running" forever.
- Settings tests and the demo server no longer read or overwrite your real `~/.glassbox/config.json`.

## [0.14.0] - 2026-06-17



- Right-click any sidebar file to open a themeable context menu of actions
- Context menu: reveal a file in Finder / File Explorer / your file manager
- Context menu: copy a file's absolute path, or repo-relative path with Option/Alt held
- Context menu: mark a file reviewed or pending directly from the menu
- Context menu: open a file in its default editor or GUI application
- AI model lists are now discovered live from Anthropic, OpenAI, and Google APIs
- Saved AI models no longer go stale — the list refreshes from your provider


- Consolidated two overlapping share banners into one "Love Glassbox?" section
- Share prompt now appears after real usage and stays hidden for 30 days once dismissed
- Copy-path menu label updates live to show absolute vs. relative path as you hold Alt
- Platform-aware "Reveal" label matches your OS file manager
- AI default models updated to current Opus 4.8, Sonnet 4.6, and Haiku 4.5


- "Open in Default Editor" now actually opens files instead of silently doing nothing
- Fixed AI analysis failing with a 404 from a retired default Anthropic model snapshot
- Stale AI model IDs in your config now self-heal to the current same-tier model
- Fixed the Claude MCP channel failing to launch in desktop (Tauri) builds
- Silent I/O failures no longer masquerade as "No changes found" (logged under --debug)


- Bounded the go-to-definition repo scan so a missed symbol can't read the whole repo

## [0.13.3] - 2026-06-17


No changes

## [0.13.2] - 2026-06-17


Maintenance release. No user-facing changes — this release only corrects an
internal desktop release-workflow script so packaged builds publish correctly.

## [0.13.2] - 2026-06-17



- Desktop app now shuts the dev server down cleanly on quit, no lingering process.
- Fixed app commands not reaching the localhost WebView in the desktop app.
- Fixed the Linux desktop build (macOS-only menu import no longer breaks it).


- Refreshed demo scenarios with regenerated assets (domotion-svg upgraded to 0.13.3).
- Added a download section to the release page.


- Bumped dependencies and cleared all outstanding audit advisories.

## [0.13.2] - 2026-06-17


- Fixed Tauri app commands being unavailable to the localhost WebView.
- The dev server now shuts down cleanly when the desktop app quits.

- Refreshed demo-mode assets (upgraded domotion-svg, regenerated demos).

## [0.13.2] - 2026-06-17



- Desktop app: grant app commands to the localhost WebView so they work reliably.
- Desktop app: the dev server now shuts down cleanly when you quit.

## [0.13.0] - 2026-06-17



- Added a download section to the release page for grabbing desktop builds.


- Desktop app: granted app commands to the localhost WebView so in-app actions work reliably.
- Desktop app: the dev server is now killed cleanly on quit instead of lingering.


- Refreshed demo-mode assets via the domotion-svg upgrade for cleaner sample diffs.


- Cleared all dependency audit advisories and bumped dev dependencies and security patches.

## [0.12.0] - 2026-06-04


- New `glassbox --diff <A> <B>` mode: compare any two files or folders outside git history
- Use Glassbox as a `git difftool`: register the `glassbox-difftool` bridge and review diffs in the browser
- Register `glassbox-difftool` directly from the CLI or the Settings dialog
- Per-file difftool mode accumulates each file into a single, growing browser session
- `git difftool` launches the native desktop window with single-window accumulation
- Desktop install now bundles `glassbox-difftool` (shim + symlink), ready to register
- Image and SVG visual comparison now work inside difftool sessions
- Full `git difftool` support across macOS, Linux, and Windows
- Various bug fixes

## [0.11.0] - 2026-05-27


- Sidebar shows the stale-annotation count, not just a dot.

- Failed background requests now surface an error instead of a silently stuck UI.
- Fixed the image slice tool's unreachable bottom handle.

- SVGs now rasterize in a worker thread, so rendering no longer freezes the UI.
- SVG rasterization times out after 15s instead of hanging on a pathological file.
- Very long diff lines are truncated for display, so huge single-line SVGs don't freeze.
- Syntax highlighting is skipped on very long lines to avoid freezes on large SVGs.

- Upgraded kerfjs and eslint-plugin-kerfjs to 0.14.0.
- JSON reads are validated with zod instead of unchecked `as` casts.
- Path parameters are validated as non-empty, returning a structured 400 on bad input.

## [0.10.1] - 2026-05-25


Here's the drafted release notes for **v0.10.0**, ready to land in `CHANGELOG.md`:

```markdown

- Sponsor button now works in the desktop app — opens your default browser
- Stale "running" AI analyses now auto-time-out after 15 min (was silently broken)
- Review/analysis timestamps now compute in correct UTC regardless of server time zone
- Fixed two regressions where valid requests were wrongly rejected after stricter validation


- Schema-first runtime validation (zod) at every trust boundary — wire, DB rows, JSON columns, config files
- API validation now returns structured 400s that name the failing field
- Vendor AI-API responses validated on read, so an upstream breaking change fails loudly instead of silently
- Upgraded embedded Postgres (PGlite 0.4.5); existing local databases migrate automatically
- Cleared 6 production and 5 dev dependency vulnerabilities
- Added a release-time security-audit gate plus Dependabot
- New Dockerized Linux e2e harness (`npm run test:e2e:docker`) mirroring CI
- E2E suite is now hermetic — no real AI API key required
- Added a memory-stability test suite to catch heap/listener leaks across interaction loops
- Upgraded kerfjs to 0.13 and added Cursor editor support (`.cursorrules`)

**Notes on scope and judgment calls:**

- This cycle was hardening-heavy. There are no genuine **New features**, **UX improvements**, or **Performance** entries, so I dropped those headings per the rules.
- I landed 14 bullets rather than padding toward the 15–40 ceiling — the honest volume of distinct user-visible/dev-relevant work here. The 13 commits collapse a lot (GB-804/805/805-follow-up are one zod-migration arc; GB-812/813 are one security arc).
- **Security/dependency** items live under *Developer-facing* since the allowed heading set has no Security section, and these are supply-chain/build-adjacent. If you'd prefer a dedicated `## Security` heading in your CHANGELOG (outside the constrained set), say so and I'll split them out.
- I included the test/CI items (Docker harness, hermetic e2e, stability suite, audit gate) under *Developer-facing* despite the general "exclude test/CI" rule, reading the explicit *Developer-facing* heading + the "be thorough" instruction as intent to record substantial contributor-facing infra. If you want a stricter cut that drops those, the user-facing core is the 4 **Bug fixes** plus the zod-validation, PGlite, and vulnerability bullets.

## [0.10.0] - 2026-05-25


Here's a draft for CHANGELOG.md. This cycle is heavy on type-safety hardening, dependency work, tests, and CI — so most of the user-visible content lands in Bug fixes and Developer-facing; there's genuinely no new feature, UX, or performance work to report, so I've omitted those headings rather than pad them.

```markdown

- Sponsor button now opens in your default browser in the desktop app (was a no-op).
- AI analysis no longer gets stuck "running" — the 15-minute auto-timeout now fires.
- Analysis timestamps are now computed in correct UTC regardless of server timezone.
- Fixed two regressions where stricter validation rejected previously-valid input.
- Legacy or corrupt diff data now degrades gracefully instead of breaking the view.


- Runtime validation (zod) now guards every trust boundary — wire, DB, JSON, config.
- AI provider responses are now validated; vendor API changes fail with clear errors.
- Upgraded embedded PostgreSQL (PGlite 0.3.15→0.4.5) with auto-migration for existing data.
- Resolved 11 dependency vulnerabilities (6 production, 5 development).
- Added a security-audit gate to the release pipeline plus Dependabot monitoring.
- Upgraded the kerfjs UI runtime to 0.13.
- Added Cursor editor support (`.cursorrules`) for contributors.

## [0.9.11] - 2026-05-22


- Add a GitHub Sponsors button to the sidebar share section with a heart icon
- Add a Sponsor section to the README with a GitHub Sponsors badge

- Sidebar share section now shows Share and Sponsor as evenly-sized side-by-side buttons
- Rename the share section label from "Know someone who'd love this?" to "Love Glassbox?"

- Fix the sidebar review mode label printing the full commit SHA twice and wrapping
- Shorten 40-char commit hashes to 7 chars in the sidebar, review history, and exports
- Range mode now shortens each endpoint independently (e.g. `range: main..<short>`)
- Drop the redundant `(SHA)` suffix from the exported review markdown mode line
- Long branch names and file patterns in the sidebar review mode now wrap cleanly

- Upgrade kerfjs and eslint-plugin-kerfjs from 0.11.1 to 0.12.0

## [0.9.10] - 2026-05-22


- Fixed a crash when switching between files in the diff viewer that broke the outline breadcrumb.
- Restored the theme editor's Reset feature for custom themes, which previously always fell back to the dark theme.

- Enabled the GitHub Sponsor button on the repository.

## [0.9.9] - 2026-05-22


- Find-in-diff now matches text that crosses syntax-highlight span boundaries, so searches like `raw(` highlight and navigate correctly inside colorized code.
- Matches split across multiple DOM text nodes are treated as a single logical match for highlighting and active-match navigation.

## [0.9.8] - 2026-05-22


- Find-in-diff now matches text that spans syntax-highlight boundaries (e.g. `raw(`), highlighting and navigating the full match as one hit.

## [0.9.7] - 2026-05-22


- Prevent server out-of-memory when selecting files with very long lines (source maps, minified bundles) by capping char-diff work per line.
- Fix category badge in the new-annotation form so clicking it opens the reclassify popup and the chosen category sticks on save.

## [0.9.6] - 2026-05-21


- Bumped kerfjs and eslint-plugin-kerfjs to ^0.11.1.
- Migrated delegate() selectors to attr()-based ACTIONS/CTX constants to clear new `kerfjs/prefer-attr-selector` lint warnings.

## [0.9.5] - 2026-05-21


- Upgraded kerfjs and eslint-plugin-kerfjs to 0.11.x.
- Migrated raw-file display, language picker, outline breadcrumb, and image metadata panel to the kerf mount/signal/delegate pattern.

## [0.9.4] - 2026-05-20


- Upgraded kerfjs and eslint-plugin-kerfjs to 0.10.0 (from 0.8.2).
- Completed kerf audit cleanup pass across sidebar, theme manager, and related views.
- Replaced manual `each()` loops with `.map()` in sidebar risk and narrative file lists.
- Rebuilt the theme manager's delete-confirm modal as a single `toElement()` call.
- Removed the legacy `bindSelectSync()` helper; coverage backed by a new e2e spec.

## [0.9.3] - 2026-05-20



- Unified beta and release-candidate publish workflows into a single GitHub Actions pipeline.
- Switched npm publishing to OIDC trusted publishing (no long-lived npm tokens).
- GitHub Release publication is now atomic: draft → upload all assets → flip to published, so partial/broken releases are no longer visible to users.

## [0.9.2] - 2026-05-19


- Upgrade kerfjs to ^0.8.2 and adopt eslint-plugin-kerfjs for lint coverage of kerf patterns

## [0.9.1] - 2026-05-18

- Upgrade kerfjs ^0.6.0 -> ^0.8.0

## [0.9.0] - 2026-05-14

- Migrate JSX runtime to kerfjs and normalize spelling to American English

## [0.8.2] - 2026-05-03

- Auto-scroll sidebar to keep selected file visible
- Code cleanup

## [0.8.1] - 2026-04-08

- Fixes for Claude channel integration

## [0.8.0] - 2026-04-08

- - Added support for experimental Claude channels, which lets one tell Claude to absorb / act on review feedback directly within Glassbox

## [0.7.9] - 2026-04-08

- Add a Share Glassbox button and periodic prompt to share Glassbox with friends and colleagues

## [0.7.8] - 2026-04-07

- Fixed image slice mode issue

## [0.7.7] - 2026-04-03

- Fixed permissions on RC workflow

## [0.7.6] - 2026-04-03

- Fixed permissions on RC workflow

## [0.7.5] - 2026-04-03

- Making sure desktop apps get released after npm package release

## [0.7.4] - 2026-04-03

- Fixed RC GitHub action

## [0.7.3] - 2026-04-03

- Fixed release candidate GitHub action script

## [0.7.2] - 2026-04-03

- Updated GitHub actions configuration

## [0.7.2] - 2026-04-03

- Updated GitHub actions configuration

## [0.7.2] - 2026-04-03

- Fixed lint issues

## [0.7.2] - 2026-04-03

- Testing new CI/CD integration

## [0.7.1] - 2026-04-02

- fixed npm installed versions
- Lint fixes, input validation, docs updates, TypeScript strict-mode fixes, and createElement cleanup
- Updated for some inconsistencies between docs and code

## [0.7.0] - 2026-04-02

- Added support for themes with several built-in options and customization support
- Moved AI-supporting profile settings into their own tab
- Code cleanup and more testing

## [0.6.0] - 2026-03-27

- Security hardening: localhost binding, shell injection fixes, and security requirements doc

## [0.5.1] - 2026-03-27

- Redesigned settings dialog with tabbed interface

## [0.5.0] - 2026-03-23

- Jump to definition: command-clicking (or other OS equivalent) now jumps to symbol definition, where it can
- Added navigation stack

## [0.4.4] - 2026-03-22

- Individual character differences are now highlighted when at least 20% of lines are the same

## [0.4.3] - 2026-03-21

- Internal code cleanup

## [0.4.2] - 2026-03-20

- Renaming DMG files to be more friendly in the GitHub release artifacts list
- cli install script now creates /use/local/bin if needed

## [0.4.1] - 2026-03-19

- Fixed production build issue with SVG support
- Fixed issue where last view mode choices weren't remembered

## [0.4.0] - 2026-03-19

- Added special support for SVGs
- Added Show in Finder (or other OS equivalent) button

## [0.3.6] - 2026-03-17

- Added support for Edit > Find option when running as native app

## [0.3.5] - 2026-03-17

- Split the GitHub action into 2 separate steps to avoid race condition

## [0.3.4] - 2026-03-17

- Fixed GitHub action for creating release notes

## [0.3.3] - 2026-03-17

- Image diffing mode now remembers which tab was last used (Metadata / Difference / Slice)

## [0.3.2] - 2026-03-16

- Replaced Sharp with lightweight image header parsing (no native dependencies), fixing metadata extraction in production builds

## [0.3.1] - 2026-03-16

- Improved one-sided image diffing (added/removed cases) — shows Metadata/Image modes instead of failing
- Moved software update banner to a horizontal row across the top of the app
- `.glassbox/latest-review.md` is now auto-exported as annotations change (debounced), not only on Complete Review
- Clicking Complete Review no longer shows an extra confirmation step

## [0.3.0] - 2026-03-16

- Added a refresh button to update diffs without restarting
- Added image comparison for binary images (PNG, JPEG, GIF, WebP) with metadata, difference (blend), and slice modes
- Added "Ignore Whitespace" toggle in the bottom toolbar

## [0.2.8] - 2026-03-16

- Fixed software update flow when manually checking via the settings panel — install banner now appears immediately

## [0.2.7] - 2026-03-16

- Changed data directory from global (`~/.glassbox/`) to per-project (`.glassbox/`), allowing multiple instances on different projects
- Added `--data-dir` CLI option

## [0.2.6] - 2026-03-16

- Auto-generates `/glassbox` skill files for Claude Code, Cursor, GitHub Copilot, and Windsurf
- Improved text selection: line numbers excluded from clipboard, split view isolates selection to one column

## [0.2.5] - 2026-03-14

- Added "Check for Updates" option in settings panel
- Fixed automatic update support

## [0.2.4] - 2026-03-13

- Exposed app name setting in settings panel
- Fixed issue where sidecar Node process wasn't properly killed on exit
- Fixed spurious system changes popup (software update now prompts to install)
- Added safety checks to prevent multiple instances on the same project

## [0.2.3] - 2026-03-13

- Fixed app icon

## [0.2.2] - 2026-03-13

- Added GitHub Actions CI/CD for automated desktop builds

## [0.2.1] - 2026-03-13

- Added Tauri desktop app for native-like experience (macOS, Linux, Windows)

## [0.2.0] - 2026-03-10

- Added optional AI-powered features: risk analysis, narrative reading order, and guided review
- Supports Anthropic (Claude), OpenAI, and Google (Gemini) via user-provided API keys

## [0.1.4] - 2026-03-07

- Fixed line number attribution sometimes using old-side numbers in export
- Annotation input now spans both columns in split view
- Improved context expansion at end of files

## [0.1.3] - 2026-03-06

- Fixed sidebar folder collapse state not persisting
- Added ESLint to the codebase

## [0.1.2] - 2026-03-06

- Added syntax highlighting
- Added code outline navigation (functions, classes, methods)
- General code improvements

## [0.1.1] - 2026-03-05

- Fixed GitHub repository path in package metadata

## [0.1.0] - 2026-03-05

- Initial release
