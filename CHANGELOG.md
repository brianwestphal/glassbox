# Changelog

All notable changes to Glassbox are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

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
