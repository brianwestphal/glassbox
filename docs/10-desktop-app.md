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

### 10.6 External Links

- External links (e.g., the Sponsor link) shall open in the user's default system browser.
- Because the desktop app runs the UI in a webview with no concept of a new tab, an anchor's `target="_blank"` does not reach a real browser — clicking such a link in the webview does nothing. To handle this, when running inside the desktop shell the client shall route external-link clicks to the local server's `POST /api/open-external` endpoint, which opens the URL in the OS default browser (the same OS-open mechanism used by "reveal in file manager").
- In a standard browser (CLI launch), the link shall retain its default `target="_blank"` behavior so it opens a new tab in the same browser; the desktop routing shall apply only when the Tauri runtime is detected.
- The `/api/open-external` endpoint shall accept only `http`/`https` URLs.

### 10.7 macOS Entitlements

- The app shall declare entitlements for JIT compilation, unsigned executable memory, and library validation bypass (required for PGLite WASM under Hardened Runtime).

## Non-Functional Requirements

### 10.8 Platform Support

- The desktop app shall be distributed for: macOS (Apple Silicon + Intel), Linux (x86_64), and Windows (x86_64).
- macOS builds shall be code-signed and notarized with Apple Developer credentials.
- CI/CD shall produce all platform artifacts on git tag push via GitHub Actions.
- **Active testing is performed only on macOS.** Linux and Windows builds are produced by the same pipeline and intended to work, but are not regularly exercised by the maintainers. Documentation (`README.md`) shall make this explicit and invite external contributors to test, file issues, and submit fixes for Linux and Windows.

### 10.9 CLI Symlink

- On **macOS and Linux**, the CLI install creates a **symlink** pointing into the installed app bundle, so app updates automatically update the CLI without re-installation.
- On **Windows**, symlinks require elevated privileges, so the CLI is installed as a **copy** (`glassbox.cmd`) rather than a symlink (see `src-tauri/src/lib.rs`). A copy does not auto-track app updates the way a symlink does; reinstalling the CLI from a newer app refreshes it.
