# 14. Security

Requirements for network security, input validation, and safe system interactions.

## Functional Requirements

### 14.1 Network Binding

- The HTTP server shall bind exclusively to `127.0.0.1` (IPv4 loopback), ensuring it is not reachable from the local network or any external interface.
- The Tauri desktop app shall connect to the server via `localhost` only.

### 14.2 Input Validation

- All API endpoints that accept request bodies shall validate the body structure at runtime before processing. TypeScript type annotations alone are not sufficient.
- All API endpoints that accept query parameters shall validate parameter types and ranges (e.g., numeric parameters shall be checked for `NaN`, string parameters shall be checked for presence when required).
- Path parameters (e.g., `:fileId`, `:id`) shall be validated as non-empty strings before use in database lookups.
- Path parameters that reach the **filesystem** (plugin ids, theme ids) shall additionally be validated as safe slugs — alphanumeric first character, then alphanumerics/`.`/`_`/`-`, no path separators (`requireSlugParam`, `src/utils/safeSlug.ts`). Hono percent-decodes params, so without this an encoded `..%2F` id would traverse out of the target directory before a destructive call like `rmSync`/`unlinkSync`. The plugin-manifest `id` field enforces the same pattern at the schema (doc 29), since it becomes an install-directory path segment.
- File paths accepted via query parameters (e.g. `/file-raw?path=`) shall be contained to the repository root — resolve, then reject any result whose relative path escapes (`403`).
- Validation failures shall return HTTP 400 with a descriptive error message.

### 14.3 Command Execution

- The application shall not use `execSync()` or `exec()` with string interpolation for constructing shell commands.
- All external process invocations shall use `spawnSync()`, `execFileSync()`, or equivalent functions that accept argument arrays, avoiding shell interpretation of arguments.
- File paths, git refs, and user-provided values shall never be interpolated into shell command strings.
- The "Open in Default Editor" action (doc 21) opens the file through the OS default-open handler (`open` / `start` / `xdg-open`) via `openOS(path, 'edit')`, with the file path passed as a separate argv (never interpolated into a shell command string), so a path containing spaces or shell metacharacters is safe.
- The `--on-complete <command>` hook (doc [2](2-cli-and-server.md) §2.3a) is the one place a **whole command string** is run through the shell. This is deliberate and safe within the threat model: the command comes **only** from the user's own CLI invocation — there is no API or network input that can set it — and the server binds to localhost only (14.1/14.6). Glassbox passes data to it via **environment variables** (`GLASSBOX_REVIEW_JSON` etc.), never by interpolating values into the command string, so review content can't inject shell syntax. It runs no command unless the user explicitly opted in by passing `--on-complete`.

### 14.4 API Key Storage

- API keys shall be stored preferentially in the system keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager).
- When keychain storage is unavailable, keys shall be stored in `~/.glassbox/config.json` with base64 encoding and `0600` file permissions.
- API keys shall never be logged, included in error messages, or exposed through API responses.

## Non-Functional Requirements

### 14.5 Transport

- The server uses plaintext HTTP. This is acceptable because the server binds to localhost only and is not network-accessible. No TLS is required for the local loopback interface.

### 14.6 Authentication

- The server does not require authentication. This is acceptable because it binds exclusively to localhost, meaning only processes on the same machine can access it. The threat model assumes the local machine is trusted.

### 14.7 Error Responses

- Error responses shall not leak internal file paths, stack traces, or system details to the client beyond what is necessary for the user to understand and resolve the issue.

### 14.8 Dependency Security

- The release pipeline shall block on known-vulnerable shipped dependencies: a `npm audit --omit=dev --audit-level=high` gate in `release-candidate.yml` hard-fails the release on any high/critical advisory in the production dependency tree (npm package + bundled desktop sidecar). See doc 11 (§11.6, §11.9) for the pipeline mechanics.
- Dependency freshness between releases is maintained by Dependabot (`.github/dependabot.yml`, weekly npm), so transitive-dependency advisories don't accumulate silently between releases.
- The `--omit=dev` scope is deliberate: build/test-only tooling never reaches a user's machine, so its advisories don't affect the released artifact and would only add release-blocking noise. The threat model (localhost-only binding, trusted local machine — see 14.1/14.6) keeps practical exploitability of even shipped advisories low, but the gate clears them regardless because the fixes are typically free, non-breaking patches inside existing semver ranges.
