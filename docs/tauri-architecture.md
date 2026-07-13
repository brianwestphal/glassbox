# Tauri Desktop App Architecture

Glassbox's desktop app wraps the Node.js server in a native window using Tauri v2. This document explains how the pieces fit together.

## Why a sidecar?

PGLite (embedded PostgreSQL compiled to WASM) needs filesystem access to its data files and WASM modules. Single-binary compilers like `pkg` or `bun compile` break this because they virtualize the filesystem. So instead of compiling the server to a native binary, we bundle a **Node.js binary as a Tauri sidecar** and run the server JS bundle through it.

## File layout

```
src-tauri/
├── src/
│   ├── lib.rs              # Core app logic (setup, sidecar management, CLI install)
│   └── main.rs             # Entry point → lib.rs::run()
├── tauri.conf.json         # Tauri config (window, bundling, updater, sidecar)
├── Cargo.toml              # Rust dependencies
├── Entitlements.plist       # macOS entitlements (JIT for V8/WASM)
├── loading/
│   ├── index.html          # "Starting Glassbox..." spinner
│   └── welcome.html        # First-run CLI install wizard
├── resources/
│   ├── glassbox            # macOS CLI launcher script
│   ├── glassbox-linux      # Linux CLI launcher script
│   └── glassbox.cmd        # Windows CLI launcher batch
├── binaries/
│   └── glassbox-node-*     # Downloaded Node.js binary (per target triple)
├── server/                 # Bundled server JS + client assets + node_modules
│   ├── cli.js
│   ├── client/
│   └── node_modules/
└── icons/
```

```
scripts/
├── build-sidecar.sh        # Downloads Node.js + bundles server for production
├── ensure-sidecar-stub.sh  # Creates placeholder binary for dev mode
└── release.sh              # npm + Tauri version bumping + publish
```

## Launch flows

There are three ways the app starts, each with a different code path:

### 1. Double-click the app (no `--project-dir`)

```
User double-clicks Glassbox.app
  → Tauri binary starts
  → No --project-dir arg detected
  → Navigates to welcome.html (CLI install wizard)
  → Checks for updates in background
```

The welcome screen uses `window.__TAURI__.core.invoke()` to call `check_cli_installed` and `install_cli` Rust commands. Both commands act on the **entire CLI set** — `glassbox` and (since GB-853) `glassbox-difftool` — not just the launcher. `check_cli_installed` reports `installed: true` only when every entry is on PATH; `install_cli` symlinks all of them in a single elevated shell on macOS (one admin prompt, two symlinks) so a partial install is impossible.

**Adding a custom command** (e.g. the doc-29 `pick_plugin_folder` folder picker, GB-1048) requires **three** in-sync edits, because the frontend is a *remote* localhost origin (Tauri 2.11+ no longer auto-allows app commands there): (1) `#[tauri::command]` + `generate_handler!` in `lib.rs`; (2) `build.rs`'s `AppManifest.commands([...])`, which generates the `allow-<command>` ACL permission; (3) the matching `allow-<command>` grant in `capabilities/remote-localhost.json`. Miss (2)/(3) and `cargo build` fails with "Permission allow-… not found"; miss the grant at runtime and the webview call is rejected.

### 2. CLI launch: `glassbox` (macOS — the complex one)

This is the most involved flow because of two macOS restrictions:

- **WASM/JIT is blocked** for processes launched via `open -a` on unsigned app bundles
- **Filesystem access to `~/Documents`** is denied for unsigned apps (TCC privacy)

The solution splits server startup from the Tauri window:

```
User runs `glassbox` in a project directory
  │
  ├─ CLI script (resources/glassbox) runs in terminal context
  │   ├─ Resolves app name from project folder name
  │   ├─ Creates/updates a stub .app in .glassbox/ (for Dock/Cmd+Tab identity)
  │   ├─ Starts Node server in background (terminal context = JIT works)
  │   ├─ Waits for "running at http://..." in server output
  │   ├─ Writes URL + PID to /tmp/glassbox-server-{hash}.info
  │   └─ Runs: open -a ".glassbox/Glassbox — projectname.app"
  │
  └─ Stub app launches
      ├─ Launcher script reads /tmp info file
      ├─ Sets GLASSBOX_SERVER_URL and GLASSBOX_SIDECAR_PID env vars
      └─ exec's to the real Tauri binary with --project-dir
          ├─ Detects GLASSBOX_SERVER_URL → navigates directly (no sidecar spawn)
          ├─ Stores GLASSBOX_SIDECAR_PID for cleanup on exit
          ├─ Sets window title from folder name
          └─ Checks for updates in background
```

**Why the stub app?** Each project gets its own `.app` bundle with a unique `CFBundleName` in its `Info.plist`. This gives each instance a distinct name in the Dock and Cmd+Tab switcher (e.g., "Glassbox — myproject" vs "Glassbox — otherproject").

**Why start Node from the CLI script?** macOS blocks V8 JIT execution and restricts filesystem access for apps launched via `open -a` on unsigned bundles. By starting the Node server in the terminal (where these restrictions don't apply), we avoid PGLite WASM crashes. The server URL is passed to the Tauri window through a temp file in `/tmp/`.

### 3. Tauri binary with `--project-dir` (fallback / direct launch)

When the Tauri binary is run directly with `--project-dir` but without `GLASSBOX_SERVER_URL`, it spawns the sidecar itself:

```
Tauri binary starts with --project-dir
  → No GLASSBOX_SERVER_URL env var
  → Resolves cli.js from app resource directory
  → Spawns glassbox-node sidecar via tauri-plugin-shell
  → Reads sidecar stdout for "running at http://..."
  → Navigates window to that URL
  → Stores sidecar PID for cleanup
```

This path works for direct binary execution (e.g., during development or on platforms without stub app complexity).

## Sidecar lifecycle

The Node.js server process must be cleaned up when the Tauri window closes:

- **PID tracking**: The sidecar PID is stored in `SidecarPid` managed state, whether it comes from `GLASSBOX_SIDECAR_PID` (CLI launch) or from the sidecar spawn.
- **Exit handler**: The `.build().run()` pattern provides a `RunEvent::Exit` callback that kills the sidecar's process group on shutdown:
  - Unix: `libc::kill(-pid, SIGTERM)` — negative PID targets the process group
  - Windows: `taskkill /PID ... /T /F` — `/T` kills the process tree
- **Graceful exit only**: This cleanup runs on Cmd+Q or window close. Force-killing the Tauri process (e.g., `kill -9`) will orphan the Node server. PGLite's lock file (`postmaster.pid`) must then be manually removed before the next launch.

## Git difftool accumulating sessions (doc 19, GB-861)

Per-file `git difftool` accumulates every changed file into **one** desktop window, reusing the sidecar machinery above. The `glassbox-difftool` wrapper (`src/cli-difftool.ts`) runs once per file; the first invocation starts the session, the rest append to it:

- **Start (first file)**: the wrapper launches the platform launcher shim in `--difftool-serve` mode, detached and **without** `GLASSBOX_DIFFTOOL_BLOCK`. On macOS the shim pre-starts a `cli.js --difftool-serve` server and the app connects via `GLASSBOX_SERVER_URL` (the path above); on Linux/Windows the shim execs the Tauri binary, which spawns the sidecar — `lib.rs` forwards `--difftool-serve` to it the same way it forwards `--diff`. Either way the sidecar is one long-lived **accumulating** server (it records its port in `~/.glassbox/difftool.lock`).
- **Append (later files)**: the wrapper discovers the running server via the lockfile and POSTs the file content; no new window opens.
- **Lifecycle**: the accumulating server's PID is the sidecar PID, so closing the window runs the `RunEvent::Exit` cleanup above, kills the server, and ends the session — which releases the last file's held `git difftool` invocation. `--dir-diff` mode is unchanged (one blocking launch, the GB-856 path).

## Dev mode vs production

|                   | Dev (`tauri:dev`)                                     | Production (`tauri:build`)                       |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------ |
| Node server       | Spawned by Rust via `node --import tsx` (auto port selection) | Bundled sidecar (downloaded Node.js binary)      |
| Frontend          | Loading screen, then navigated to server URL          | Loading screen, then navigated to server URL     |
| Sidecar binary    | Stub placeholder (from `ensure-sidecar-stub.sh`)      | Real Node.js binary (from `build-sidecar.sh`)    |
| Server code       | Source TypeScript via tsx                             | Bundled `cli.js` in `server/` resource dir       |
| Port selection    | Automatic (tries 4183, increments if in use)          | Automatic (same behavior)                        |
| Apple FM helper   | Resolved by `apple-fm` from the project's `node_modules/apple-fm/bin/` (no build/wiring) | Bundled via the `apple-fm` package in `server/node_modules/`, `APPLE_FM_BIN` set by the launcher |
| Release-only code | Skipped (`#[cfg(not(debug_assertions))]`)             | Active (welcome screen, updater)                 |

In dev mode, the Rust `setup` callback (`#[cfg(debug_assertions)]`) spawns the Node server via `node --import tsx src/cli.ts --no-open` (with `TSX_TSCONFIG_PATH=tsconfig.json`), parses the server URL from stdout ("running at ..."), and navigates the webview — the same pattern production uses with the sidecar. This enables automatic port selection in dev mode, avoiding failures when port 4183 is already in use. The `beforeDevCommand` only builds client assets (CSS/JS). The sidecar binary is never used — `ensure-sidecar-stub.sh` creates a no-op placeholder so Tauri's build system doesn't complain.

The launch form (`node --import tsx`, not `npx tsx`) matters for quit: `npx tsx` is a wrapper (`npx` → `node .bin/tsx` → `node src/cli.ts`), so the stored child PID was the npx wrapper, two levels above the real server. The quit-time `kill(pid)` only reached the wrapper and the `kill(-pid)` group kill missed the server's group, orphaning the `cli.ts` server (it kept the port + lockfile, so the next launch fought a stale instance). `node --import tsx` runs `cli.ts` *in* the spawned process, so the stored PID is the server itself and the SIGTERM lands on its handler. The pure `build_dev_server_args` helper in `lib.rs` is unit-tested to pin this launch form.

## Build pipeline

### `npm run tauri:build`

1. **`scripts/build-sidecar.sh`** runs first:
   - Downloads Node.js v20 for the target platform (cached if already present)
   - Places it at `src-tauri/binaries/glassbox-node-{target-triple}`
   - Runs `npm run build` (tsup → `dist/cli.js` + client assets)
   - Copies `dist/`, client assets, and runtime `node_modules` into `src-tauri/server/`

   - Copies the **`apple-fm` package** (the on-device Apple FM provider) into
     `src-tauri/server/node_modules/` as one of the external runtime deps. Its
     bundled, signed helper binary (`bin/apple-fm-helper`) rides along — nothing
     is compiled. When a signing identity is set, the bundled helper is re-signed
     with hardened runtime as a belt-and-braces (see "Apple Foundation Models
     helper" below).

2. **`tauri build`** then:
   - Compiles Rust code
   - Bundles the `.app` (macOS), `.AppImage` (Linux), or `.msi` (Windows)
   - Includes the sidecar binary, server resources, CLI launcher scripts, and icons

### Apple Foundation Models helper (doc 22)

The on-device AI provider comes from the
[`apple-fm`](https://github.com/brianwestphal/apple-fm) package — Glassbox no
longer ships its own Swift CLI. `apple-fm` is a Node library over its own bundled
native helper (`node_modules/apple-fm/bin/apple-fm-helper`), and `src/ai/apple-foundation.ts`
calls its `probe` / `generate`. The package is copied into the sidecar's
`node_modules` by `build-sidecar.sh` (it's a `tsup`-external runtime dep). At
runtime the launcher exports **`APPLE_FM_BIN`** pointing at
`Contents/Resources/server/node_modules/apple-fm/bin/apple-fm-helper` (set on the
self-spawned sidecar in `lib.rs`); `apple-fm` also discovers that path on its own,
so the export is a robust belt-and-braces. The bridge reports "unavailable" off
macOS / off Apple Silicon / when the probe fails, so this is safe on every OS.

In **dev** (`tauri:dev`), the Node server runs from source and `apple-fm` resolves
its helper straight from the project's `node_modules/apple-fm/bin/`, so the Apple
platform appears in dev on a capable machine (macOS 26 + Apple Intelligence) with
no build step or env wiring.

**Signing & notarization:** `apple-fm` ships its helper already Developer-ID
signed with hardened runtime and independently notarized, and the embedded
signature survives the package copy into the bundle, so `tauri-action`'s
notarization of the whole app covers it — no dedicated macOS-26 compile/sign job
is needed. When a signing identity is available (`APPLE_SIGNING_IDENTITY`, falling
back to `CODESIGN_IDENTITY`) `build-sidecar.sh` re-signs the bundled helper with
hardened runtime so the bundle's signature stays self-consistent. Confirming the
bundled helper runs on-device and passes Gatekeeper after notarization requires
real macOS-26 hardware with Apple Intelligence (doc-22 §22.9, maintainer smoke
test).

### CI/CD (`.github/workflows/release-desktop.yml`)

Triggered by git tags (`v*`) or manual dispatch. Builds for 4 targets:

- macOS aarch64 (Apple Silicon) + x86_64 (Intel)
- Linux x86_64
- Windows x86_64

macOS builds are code-signed and notarized via Apple Developer credentials. All builds are update-signed with the Tauri updater key. Creates a draft GitHub Release with all artifacts + `latest.json` for auto-updates.

## Auto-updates

The app checks for updates on every launch via `tauri-plugin-updater`. Updates are served from GitHub Releases — the CI generates a `latest.json` file that the updater reads to determine if a new version is available. Updates are verified against a public key embedded in `tauri.conf.json`.

The CLI symlink (`/usr/local/bin/glassbox` → `Glassbox.app/Contents/Resources/resources/glassbox`) automatically points to the updated app — no re-installation needed.

## macOS entitlements

`Entitlements.plist` grants three permissions required for V8/WASM execution under Hardened Runtime (which is required for notarization):

- `com.apple.security.cs.allow-jit` — V8 JIT compilation
- `com.apple.security.cs.allow-unsigned-executable-memory` — WASM memory
- `com.apple.security.cs.disable-library-validation` — Loading bundled Node.js

Without these, PGLite's WASM crashes with `RuntimeError: unreachable` on CI-built (code-signed) binaries.

## Platform-specific CLI launchers

Each platform has a launcher script bundled as a Tauri resource:

| Platform | File                       | Install location                                       | Mechanism                                     |
| -------- | -------------------------- | ------------------------------------------------------ | --------------------------------------------- |
| macOS    | `resources/glassbox`       | `/usr/local/bin/glassbox` (symlink)                    | Starts server, creates stub `.app`, `open -a` |
| Linux    | `resources/glassbox-linux` | `~/.local/bin/glassbox` (symlink)                      | Starts Tauri binary directly                  |
| Windows  | `resources/glassbox.cmd`   | `%LOCALAPPDATA%/Programs/glassbox/glassbox.cmd` (copy) | Starts Tauri binary with `start`              |

The macOS launcher is significantly more complex due to the stub app mechanism. Linux and Windows launchers are straightforward — they just exec the Tauri binary with `--project-dir`.
