# 10. Desktop App

Requirements for the Tauri desktop application and platform distribution.

## Functional Requirements

### 10.1 Native Window

- The desktop app shall wrap the Node.js server in a native window using Tauri v2.
- The window title shall display the project name, configurable via `.glassbox/settings.json` (`appName` field), defaulting to "Glassbox — {folder name}."
- On macOS, each project shall get its own Dock/Cmd+Tab identity via a stub `.app` bundle.

### 10.2 Sidecar Management

- The desktop app shall bundle a Node.js binary as a sidecar to run the server.
- The sidecar process shall be tracked by PID and killed on app exit.
- On Unix, sidecar cleanup shall use direct kill followed by process group kill (to handle backgrounded processes that aren't group leaders).
- On Windows, sidecar cleanup shall use `taskkill /T /F` for process tree termination.

### 10.3 Launch Flows

The desktop app shall support three launch flows:

- **Direct app launch** (no `--project-dir`) — show welcome/setup screen with CLI installation wizard.
- **CLI launch** (macOS) — the CLI wrapper starts the Node server in the terminal context (for JIT/filesystem access), creates a stub `.app`, and passes the server URL via temp file to the Tauri binary.
- **Direct binary launch** with `--project-dir` — spawn the sidecar directly and navigate to it when ready.

### 10.4 CLI Installation

- The welcome screen shall check if the CLI is installed and offer one-click installation.
- CLI installation locations:
  - macOS: `/usr/local/bin/glassbox` (symlink, requires admin prompt)
  - Linux: `~/.local/bin/glassbox` (symlink)
  - Windows: `%LOCALAPPDATA%\Programs\glassbox\glassbox.cmd` (copy, adds to user PATH)
- The welcome screen shall display the manual installation command if automatic installation fails.

### 10.5 Software Updates

- The app shall check for updates on every launch via the Tauri updater plugin.
- Updates shall NOT be installed automatically. The available version shall be stored and surfaced to the user.
- An update banner shall appear in the review UI when an update is available, showing the version number.
- The user shall be able to install the update via an "Install Update" button.
- The settings dialog shall include a "Check for Updates" button for manual update checks.
- Updates shall be cryptographically verified against a public key embedded in the app configuration.
- Updates shall be served from GitHub Releases.

### 10.6 macOS Entitlements

- The app shall declare entitlements for JIT compilation, unsigned executable memory, and library validation bypass (required for PGLite WASM under Hardened Runtime).

## Non-Functional Requirements

### 10.7 Platform Support

- The desktop app shall be distributed for: macOS (Apple Silicon + Intel), Linux (x86_64), and Windows (x86_64).
- macOS builds shall be code-signed and notarized with Apple Developer credentials.
- CI/CD shall produce all platform artifacts on git tag push via GitHub Actions.

### 10.8 CLI Symlink

- The CLI symlink shall point into the installed app bundle, so app updates automatically update the CLI without re-installation.
