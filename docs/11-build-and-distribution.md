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

- For npm installs, the system shall check for newer versions once per day by querying the npm registry.
- The update check shall detect the user's package manager (npm, yarn, pnpm, bun) and suggest the appropriate upgrade command.
- The update check shall time out after 5 seconds to avoid blocking startup.

## Non-Functional Requirements

### 11.5 Build Pipeline

- The server shall be built with tsup as an ESM bundle, with external dependencies (`@electric-sql/pglite`, `hono`, `@hono/node-server`).
- The client shall be built as an IIFE bundle (es2020 target, minified) via esbuild.
- SCSS shall be compiled to CSS separately via sass.
- Both server and client builds shall share the custom JSX runtime via the `#jsx` import alias.

### 11.6 CI/CD

- Desktop releases shall be built via GitHub Actions on git tag push.
- macOS builds shall be code-signed and notarized.
- All builds shall include updater signature artifacts (`latest.json`).
- Release artifacts shall be published as draft GitHub Releases for manual promotion.

### 11.7 Development Mode

- `npm run dev` shall build client assets and run the server via tsx (TypeScript directly, no full build required).
- `npm run tauri:dev` shall start both the Node server and Tauri window in development mode.
- A sidecar stub script shall be created for dev mode so Tauri's build system doesn't require the real Node binary.
