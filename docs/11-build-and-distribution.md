# 11. Build and Distribution

Requirements for building, packaging, and distributing the application.

## Functional Requirements

### 11.1 npm Distribution

- The application shall be installable via `npm install -g glassbox`.
- The npm package shall include a single-file server bundle (`dist/cli.js`) with a Node shebang.
- The npm package shall require Node.js 20+ and git.

### 11.2 Desktop Distribution

- Desktop builds shall be produced via `npm run tauri:build`.
- Build artifacts per platform:
  - macOS: `.dmg` installer
  - Linux: `.AppImage` and `.deb`
  - Windows: `.msi` and `.exe`
- The build pipeline shall download Node.js v20 for the target platform and bundle it as a sidecar.
- The build shall detect and reject dev-mode sidecar stubs (file size < 1MB) in production builds.

### 11.3 Version Management

- Versions shall be synchronized across `package.json`, `tauri.conf.json`, and `Cargo.toml`.
- The release script shall handle version bumping across all manifests.

### 11.3.1 Release Notes Generation

- The release script's preflight shall `git fetch --tags --prune --prune-tags origin` so the comparison-base lookup and the RC / beta tag auto-increment loops see the real upstream tag list — a stale local tag list would either anchor the commit log at an out-of-date base (notes include changes already shipped) or reuse a tag number that already exists upstream (push rejected). A fetch failure shall warn but not abort, so offline runs still proceed against the local tag list.
- The release script shall draft release notes automatically when the `claude` CLI (Claude Code) is available on the user's PATH, then open the draft in the user's editor for review and edits.
- The comparison base for the commit log shall depend on the release mode:
  - **Stable** releases shall diff against the last **production** tag (`vX.Y.Z` with no `-rc.N` / `-beta.N` suffix), via `git describe --tags --abbrev=0 --exclude='*-beta.*' --exclude='*-rc.*'`, so the notes cover every change since the previous stable — including changes that previously shipped in betas.
  - **Beta** releases shall diff against whatever the immediately-previous tag was (beta or stable), so each beta's notes don't repeat bullets that already appeared in an earlier beta's notes.
- The prompt body shall branch on release mode:
  - **Beta**: ask for 5–10 short user-facing markdown bullets only (no heading, no preamble), explicitly excluding ticket IDs, refactors, tests, docs, and build/CI tweaks.
  - **Stable**: ask for 15–40 bullets grouped under H2 headings (`## New features`, `## UX improvements`, `## Bug fixes`, `## Performance`, `## Developer-facing`), scaled to the commit-count volume; omit empty sections.
- The prompt shall be piped to `claude -p` via **stdin** (not as a positional argument) so the script doesn't hit `ARG_MAX` on stable cycles with hundreds of commit subjects.
- The script shall strip stray code-fence wrappers (`` ``` ``) and trim leading/trailing blank lines from the AI output.
- The script shall guard against `claude -p` returning an auth/network error message as content. When the first line matches `^(Failed to authenticate|API Error:|Error:)`, the script shall treat the output as empty, warn the user, and fall back to a blank editor with guidance comments — never silently embed the error string in the CHANGELOG or annotated tag body.
- The editor shall be seeded with guidance lines prefixed with `#`. The `ask_multiline` helper shall strip every `#`-prefixed line from the saved content on read-back, so the comments never reach `CHANGELOG.md` or the annotated tag body.
- On a resumed release run, the script shall skip the AI draft entirely if saved release notes already exist in the state file and re-open the editor with the saved content — so a re-run never wastes a model call or overwrites in-progress edits.
- When the `claude` CLI is not installed, the script shall fall back to a blank editor with the same `#`-prefixed guidance comments.

### 11.4 Update Checking (npm)

- For npm installs, the system shall check for newer versions once per day by querying the npm registry's `latest` dist-tag.
- The update check shall detect the user's package manager (npm, yarn, pnpm, bun) and suggest the appropriate upgrade command.
- The update check shall time out after 5 seconds to avoid blocking startup.
- The update check shall not surface beta releases to stable users (beta releases live under the `beta` dist-tag, not `latest`).

### 11.8 Beta Releases

- The release script shall support a `--beta` mode (`npm run release:beta`) for shipping opt-in pre-release builds.
- Beta mode shall skip version-file bumps, CHANGELOG edits, and the release commit; instead it shall create and push a `v{ver}-beta.{N}` annotated tag off HEAD.
- The beta CI workflow (`.github/workflows/release-beta.yml`) shall:
  - run lint, type check, unit tests, E2E tests, and `npm pack --dry-run` validation
  - publish to npm with `--tag beta` (so `npm install glassbox@beta` resolves to the latest beta and stable users on `latest` are unaffected)
  - build Tauri bundles for every platform and attach them to a GitHub Release flagged `prerelease: true`
- Windows prerelease (RC and beta) builds shall skip the MSI bundle and ship the NSIS `.exe` installer only. The Tauri MSI bundler requires the optional pre-release identifier to be numeric-only (e.g. `0.9.0-1`), which conflicts with the semver-standard `-rc.N` / `-beta.N` form. Stable releases produce both NSIS and MSI because the version has no pre-release identifier.
- There shall be no auto-promotion from beta to stable. Users opt in via `npm install glassbox@beta` or by downloading from the GitHub Release page.
- The Tauri auto-updater (which reads `releases/latest/download/latest.json`) and the in-CLI upgrade nudge (which reads `registry.npmjs.org/glassbox/latest`) shall continue to point at the prior stable release because both surfaces skip prereleases automatically.
- The stable desktop release workflow shall exclude `v*-beta.*` tags from its trigger to avoid racing with the beta workflow on tag push.

## Non-Functional Requirements

### 11.5 Build Pipeline

- The server shall be built with tsup as an ESM bundle, with external dependencies (`@electric-sql/pglite`, `hono`, `@hono/node-server`, `@resvg/resvg-wasm`, `@modelcontextprotocol/sdk`, `kerfjs`).
- The client shall be built as an IIFE bundle (es2020 target, minified) via esbuild.
- SCSS shall be compiled to CSS separately via sass.
- Both server and client builds shall use the **kerfjs** JSX runtime via `jsxImportSource: 'kerfjs'` in `tsconfig.json` and `tsup.config.ts`.

### 11.6 CI/CD

- Desktop releases shall be built via GitHub Actions on git tag push.
- macOS builds shall be code-signed and notarized.
- All builds shall include updater signature artifacts (`latest.json`).
- Release artifacts shall be published as draft GitHub Releases for manual promotion.
- Three workflows handle the tag-driven release pipeline:
  - `release-candidate.yml` (triggered by `v*-rc.*`) — full validate → npm beta → smoke → promote → desktop dispatch
  - `release-beta.yml` (triggered by `v*-beta.*`) — opt-in pre-release; npm `--tag beta` + GH Release `prerelease: true`; no auto-promote
  - `release-desktop.yml` (triggered by `v[0-9]*` excluding `-rc.*` and `-beta.*`) — final desktop bundles for stable releases

### 11.7 Development Mode

- `npm run dev` shall build client assets and run the server via tsx (TypeScript directly, no full build required).
- `npm run tauri:dev` shall start both the Node server and Tauri window in development mode.
- A sidecar stub script shall be created for dev mode so Tauri's build system doesn't require the real Node binary.
