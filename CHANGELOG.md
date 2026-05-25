# Changelog

All notable changes to Glassbox are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

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
