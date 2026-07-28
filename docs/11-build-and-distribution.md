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
- The release script shall delegate release-notes drafting to [`gitgist`](https://github.com/brianwestphal/gitgist) (a `devDependency`, invoked from the project-local `node_modules/.bin/gitgist`, falling back to a globally installed `gitgist`), then open the draft in the user's editor for review and edits. gitgist owns the AI prompt, provider selection, code-fence stripping, and noise filtering, so the release script no longer hand-rolls a `claude -p` prompt.
- gitgist's default `auto` provider reuses the signed-in `claude` CLI when present, then falls through the other backends it supports (agent CLIs, the Anthropic and OpenAI APIs, a local OpenAI-compatible endpoint) and finally on-device Apple Foundation Models — so a draft is produced wherever any of those is available, with no API key required for the CLI path.
- From gitgist 1.2.0 the draft is **grounded in the range's actual code diff**, not only its commit messages, so a change buried under a terse commit subject still gets described and a claim the code doesn't support gets dropped. gitgist holds noisy paths (lockfiles, build output, vendored deps) back from the model by default while still listing them as changed, and sizes the diff budget to the chosen provider's context window. Neither the release script nor this project configures any of it — the defaults are what we rely on.
- The release script shall remain responsible only for choosing the **comparison base** (gitgist's own default tag lookup does not exclude prereleases), passing it to gitgist as a single `<base>..HEAD` positional range:
  - **Stable** releases shall diff against the last **production** tag (`vX.Y.Z` with no `-rc.N` / `-beta.N` suffix), via `git describe --tags --abbrev=0 --exclude='*-beta.*' --exclude='*-rc.*'`, so the notes cover every change since the previous stable — including changes that previously shipped in betas.
  - **Beta** releases shall diff against whatever the immediately-previous tag was (beta or stable), so each beta's notes don't repeat bullets that already appeared in an earlier beta's notes.
  - When there is no anchoring tag yet, the script shall omit the range and let gitgist fall back to its own default (latest tag → full history).
- A separate beta/stable prompt is no longer needed: gitgist's prompt scales the amount of detail to the volume of work, so a small beta range yields a tight summary and a large stable cycle a thorough, section-grouped one.
- The script shall detect a failed or unavailable draft by gitgist's **exit code** (gitgist exits non-zero with a `gitgist: …` message on stderr when no AI provider is available or the provider errors), not by sniffing stdout — eliminating the prior heuristic that scanned the first line for auth/network error signatures. On failure it shall warn (echoing gitgist's stderr tail) and fall back to a blank editor.
- gitgist emits a `_No changes in `<range>`._` placeholder (a normal, zero-exit result) for an empty range; the script shall treat that placeholder as no draft so the blank-editor fallback fires instead of seeding the placeholder into the CHANGELOG.
- The editor shall be seeded with guidance lines prefixed with `#`. The `ask_multiline` helper shall strip every `#`-prefixed line from the saved content on read-back, so the comments never reach `CHANGELOG.md` or the annotated tag body.
- On a resumed release run, the script shall skip the AI draft entirely if saved release notes already exist in the state file and re-open the editor with the saved content — so a re-run never wastes a model call or overwrites in-progress edits.
- When `gitgist` is not found (project-local nor global), the script shall fall back to a blank editor with the same `#`-prefixed guidance comments.
- An `npm run commit:msg` script shall draft a Conventional Commit message from the staged diff via `gitgist --staged --commit-message`, reusing the same tool and provider stack as release-notes drafting.

### 11.3.2 GitHub Releases Page

- The stable desktop release (`release-desktop.yml`) shall publish a GitHub Release whose body contains a per-platform **Download** summary — a grouped list (macOS / Linux / Windows) that links each installer directly, with a short plain-language note per option (e.g. "M-series Macs", "older Macs", AppImage "runs on most distros") plus an `npm install -g glassbox@<version>` line. The body shall never fall back to a generic "see the assets below" stub when the tag carries no annotation; the Download summary stands on its own. Any user-authored tag annotation is prepended above the summary.
- The release shall rename the user-facing macOS installers from Tauri's raw filenames (`Glassbox_<version>_aarch64.dmg`, `Glassbox_<version>_x64.dmg`) to friendly, dash-separated names (`Glassbox-<version>-macOS-Apple-Silicon.dmg`, `Glassbox-<version>-macOS-Intel.dmg`). Only `.dmg` assets shall be renamed — the Tauri updater's `latest.json` references the `.exe` / `.msi` / `.deb` / `.AppImage` / `.rpm` assets by their original filenames, and macOS updates use the `.app.tar.gz`, so renaming those would break auto-update.
- The download links in the release body and the asset-rename rules shall come from a single source of truth (`scripts/release/release-assets.mjs`) so a linked filename can never drift from the name actually shipped (a mismatch would 404 on the releases page). The rename shall run as a dedicated job after every platform build completes, and the draft→published flip shall depend on it, so the release becomes public only once every embedded download link resolves.

### 11.4 Update Checking (npm)

- For npm installs, the system shall check for newer versions once per day by querying the npm registry's `latest` dist-tag.
- The update check shall detect the user's package manager (npm, yarn, pnpm, bun) and suggest the appropriate upgrade command.
- The update check shall time out after 5 seconds to avoid blocking startup.
- The update check shall not surface beta releases to stable users (beta releases live under the `beta` dist-tag, not `latest`).

### 11.8 Beta Releases

- The release script shall support a `--beta` mode (`npm run release:beta`) for shipping opt-in pre-release builds.
- Beta mode shall skip version-file bumps, CHANGELOG edits, and the release commit; instead it shall create and push a `v{ver}-beta.{N}` annotated tag off HEAD.
- A **non-interactive** beta path (`npm run release:beta:auto` → `scripts/release-beta-auto.sh`) shall cut the same `v{ver}-beta.{N}` tag with no prompts and no `$EDITOR`, for automation / unattended runs. It is a separate script (not the interactive `release.sh` driven by piped input) because that script is a resumable, `read`-driven state machine that can't be cleanly automated. It shall: preflight (clean tree + on main/master, but **not** `npm whoami` — beta publishes run in CI via the npm token, so no local login is needed to cut the tag); default the target version to package.json's version when that hasn't shipped as a stable tag, else the next minor, overridable with `X.Y.Z` / `--version X.Y.Z`; draft notes with gitgist (AI → `--no-ai` → `git log` pointer), overridable with `--notes <file>` / `--notes-stdin`; run build + unit tests (auto-retry once, bypassable with `--skip-tests`) + lint + typecheck; then auto-increment + push the annotated tag. `--dry-run` performs every step except creating/pushing the tag. Distinct exit codes (1 preflight/args, 2 local checks, 3 tag/push) make failures scriptable.
- The beta path shares the **same** CI workflow as release candidates — `.github/workflows/release-candidate.yml` triggers on both `v*-rc.*` and `v*-beta.*` tags, and the beta-specific behavior branches on `contains(github.ref, '-beta.')`. On a beta tag it shall:
  - run lint, type check, unit tests, E2E tests, the security/Rust gates, and `npm pack --dry-run` validation (shared with the rc path)
  - publish to npm with `--tag beta` (so `npm install glassbox@beta` resolves to the latest beta and stable users on `latest` are unaffected)
  - build signed Tauri bundles for every platform and attach them to a GitHub Release flagged `prerelease: true` (created as a draft, flipped to published once every bundle is uploaded), with **no** `promote` phase — betas stay on the `beta` dist-tag and never flip `latest` or dispatch the stable desktop release
- Windows prerelease (RC and beta) builds shall skip the MSI bundle and ship the NSIS `.exe` installer only. The Tauri MSI bundler requires the optional pre-release identifier to be numeric-only (e.g. `0.9.0-1`), which conflicts with the semver-standard `-rc.N` / `-beta.N` form. Stable releases produce both NSIS and MSI because the version has no pre-release identifier.
- There shall be no auto-promotion from beta to stable. Users opt in via `npm install glassbox@beta` or by downloading from the GitHub Release page.
- The Tauri auto-updater (which reads `releases/latest/download/latest.json`) and the in-CLI upgrade nudge (which reads `registry.npmjs.org/glassbox/latest`) shall continue to point at the prior stable release because both surfaces skip prereleases automatically.
- The stable desktop release workflow shall exclude `v*-beta.*` tags from its trigger to avoid racing with the beta workflow on tag push.

## Non-Functional Requirements

### 11.5 Build Pipeline

- The server shall be built with tsup as an ESM bundle, with external dependencies (`@electric-sql/pglite`, `hono`, `@hono/node-server`, `@modelcontextprotocol/sdk`, `kerfjs`, `apple-fm`).
- The client shall be built as an IIFE bundle (es2020 target, minified) via esbuild.
- SCSS shall be compiled to CSS separately via sass.
- Both server and client builds shall use the **kerfjs** JSX runtime via `jsxImportSource: 'kerfjs'` in `tsconfig.json` and `tsup.config.ts`.

### 11.6 CI/CD

- Desktop releases shall be built via GitHub Actions on git tag push.
- macOS builds shall be code-signed and notarized.
- The on-device Apple Foundation Models helper ships **inside the `apple-fm` dependency**, already Developer-ID signed with hardened runtime and independently notarized. `build-sidecar.sh` copies the `apple-fm` package (helper included) into the sidecar's `node_modules` like any other external dep; the helper's embedded signature survives into the app bundle, so `tauri-action`'s notarization covers it (a nested Mach-O needs only a valid Developer-ID + hardened-runtime signature, not the outer app's team). Glassbox no longer compiles, signs, or notarizes a Swift helper, so there is **no dedicated macOS-26 CI job** and no macOS 26 / Xcode 26 dependency — the bundle build stays on the proven macOS 15 image. When a signing identity is present (e.g. the maintainer's local build) `build-sidecar.sh` re-signs the bundled helper with that identity + hardened runtime as a belt-and-braces, keeping the bundle's signature self-consistent. The helper is arm64-only and simply never runs (reporting `unsupportedPlatform`) on Intel / Linux / Windows builds. See docs/22 §22.9.
- All builds shall include updater signature artifacts (`latest.json`).
- Release artifacts shall be published as draft GitHub Releases for manual promotion.
- Two workflows handle the tag-driven release pipeline:
  - `release-candidate.yml` — a **unified** workflow triggered by **both** `v*-rc.*` (release candidate) and `v*-beta.*` (beta) tags. The two tracks share every validation/publish phase and branch on `contains(github.ref, '-beta.')`:
    - `v*-rc.*` → full validate → npm `--tag beta` → smoke → **promote** (publish clean `latest`, create the final `v0.9.X` tag) → dispatch `release-desktop.yml`
    - `v*-beta.*` → full validate → npm `--tag beta` → smoke; in parallel create a draft prerelease GitHub Release, build + upload signed Tauri bundles, then flip the draft to published (`prerelease: true`, stays off `latest`). No promote, no desktop dispatch.
    - It is kept named `release-candidate.yml` (not renamed) so the npmjs.org trusted-publisher binding — which is filename-scoped — survives for both tracks (no `NPM_TOKEN` needed; publishes use npm OIDC).
  - `release-desktop.yml` (triggered by `v[0-9]*` excluding `-rc.*` and `-beta.*`, or dispatched by the rc `promote` phase) — final desktop bundles for stable releases
- The release validation phase shall include a **security-audit gate** (`audit` job in `release-candidate.yml`) that runs `npm audit --omit=dev --audit-level=high` and hard-fails the release on any high/critical advisory in a shipped (production) dependency. Dev/build/test-only advisories are excluded (they never reach a user's machine) and are kept fresh out-of-band instead (see 11.9). The gate runs alongside `lint` / `typecheck` / `test-unit` and blocks every downstream publish job.
- The release validation phase shall include a **Rust gate** (`rust` job in `release-candidate.yml`) holding the Tauri desktop shell (`src-tauri/`) to the same fast-check bar as the TypeScript: `cargo fmt --check` (formatting), `cargo clippy --all-targets -- -D warnings` (lints as errors), and `cargo test` (unit tests). The job runs on Linux and installs the webkit2gtk dev headers because the `glassbox` crate links tauri/webkit even for `clippy`/`check`; it needs no client build because everything the crate compiles against (`loading/`, `capabilities/`, `Cargo.lock`) is committed. The gate runs alongside `lint` / `typecheck` / `test-unit` / `audit` and blocks every downstream publish job, so a formatting, clippy, or test failure on the Rust side fails the release exactly like a TypeScript lint failure. (Note: this is the only Rust *test/lint* gate — the other workflows that install Rust only *compile* the app via `tauri build`.)

### 11.9 Dependency Security Auditing

- A release shall not ship a known-vulnerable production dependency: the `audit` gate in 11.6 blocks the release on a high/critical advisory in the `--omit=dev` tree.
- Dependency freshness between releases shall be maintained automatically by Dependabot (`.github/dependabot.yml`, weekly `npm` ecosystem) so patch/minor fixes — including those already inside our existing `^` semver ranges — land continuously rather than only being caught at release time.
- Dev/build/test-only dependency updates shall be grouped into a single weekly PR to cut review noise; production dependency updates shall be raised individually because each is security-relevant.

### 11.7 Development Mode

- `npm run dev` shall build client assets and run the server via tsx (TypeScript directly, no full build required).
- `npm run tauri:dev` shall start both the Node server and Tauri window in development mode.
- A sidecar stub script shall be created for dev mode so Tauri's build system doesn't require the real Node binary.
- `npm run test:e2e:docker` shall run the Playwright e2e suite inside the same pinned Linux container image CI uses (`scripts/test-e2e-docker.sh`), so developers can reproduce CI-only e2e failures locally — in particular environment-dependent ones (no keychain/API key, Linux paths/fonts) that a macOS run masks.
