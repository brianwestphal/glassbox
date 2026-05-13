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
