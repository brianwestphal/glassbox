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

The welcome screen uses `window.__TAURI__.core.invoke()` to call `check_cli_installed` and `install_cli` Rust commands. These check whether `/usr/local/bin/glassbox` exists and create the symlink (with admin prompt on macOS).

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

## Dev mode vs production

|                   | Dev (`tauri:dev`)                                     | Production (`tauri:build`)                       |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------ |
| Node server       | Runs via `npm run dev:server` (tsx, separate process) | Bundled sidecar (downloaded Node.js binary)      |
| Frontend          | Loaded from `http://localhost:4183` (dev URL)         | Loaded from `loading/index.html`, then navigated |
| Sidecar binary    | Stub placeholder (from `ensure-sidecar-stub.sh`)      | Real Node.js binary (from `build-sidecar.sh`)    |
| Server code       | Source TypeScript via tsx                             | Bundled `cli.js` in `server/` resource dir       |
| Release-only code | Skipped (`#[cfg(not(debug_assertions))]`)             | Active (sidecar spawn, welcome screen, updater)  |

In dev mode, Tauri's `beforeDevCommand` starts the Node server, and the webview connects to `devUrl`. The sidecar binary is never used — `ensure-sidecar-stub.sh` creates a no-op placeholder so Tauri's build system doesn't complain about a missing binary.

## Build pipeline

### `npm run tauri:build`

1. **`scripts/build-sidecar.sh`** runs first:
   - Downloads Node.js v20 for the target platform (cached if already present)
   - Places it at `src-tauri/binaries/glassbox-node-{target-triple}`
   - Runs `npm run build` (tsup → `dist/cli.js` + client assets)
   - Copies `dist/`, client assets, and runtime `node_modules` into `src-tauri/server/`

2. **`tauri build`** then:
   - Compiles Rust code
   - Bundles the `.app` (macOS), `.AppImage` (Linux), or `.msi` (Windows)
   - Includes the sidecar binary, server resources, CLI launcher scripts, and icons

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
