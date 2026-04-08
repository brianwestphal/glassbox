# 17. Claude Channel

Requirements for integrating with Claude Code via MCP channels so users can send review feedback directly to Claude from within Glassbox.

## Functional Requirements

### 17.1 Channel Server

- Glassbox shall include an MCP channel server (`src/channel.ts`) that bridges the Glassbox UI to a running Claude Code session.
- The channel server shall:
  - Run as a subprocess spawned by Claude Code via `.mcp.json` configuration.
  - Communicate with Claude Code over stdio using the MCP protocol.
  - Expose a local HTTP API for the Glassbox UI to trigger channel events.
  - Write its HTTP port to `.glassbox/channel-port` on startup.
  - Clean up the port file on exit.
- The channel server shall support:
  - `POST /trigger` — Send a channel event to Claude Code with arbitrary content.
  - `GET /health` — Health check endpoint.

### 17.2 Channel Configuration

- A "Claude Channel" toggle shall be available in the Settings > Experimental tab.
- When enabled, Glassbox shall:
  - Register the channel server in the project's `.mcp.json` file under the key `glassbox-channel`.
  - Display instructions for the user to launch Claude Code (e.g., `claude` in the project directory).
  - Provide a "Copy" button for the launch command.
- When disabled, Glassbox shall:
  - Remove the `glassbox-channel` entry from `.mcp.json`.
- The enabled/disabled state shall be stored in `~/.glassbox/config.json` under `channelEnabled`.
- Before enabling, Glassbox shall check if Claude Code is installed and meets the minimum required version (v2.1.80+).

### 17.3 Channel Status

- The UI shall indicate whether Claude Code is connected:
  - Check the channel health endpoint periodically.
  - Show a status indicator (connected/disconnected) in the settings dialog.

### 17.4 Completion Modal Integration

- When a review is completed and Claude Channel is enabled and connected:
  - The completion modal shall include a "Send to Claude" button (in addition to the existing "Done" button).
  - Clicking "Send to Claude" shall trigger a channel event instructing Claude to read the exported review file and apply the feedback.
  - The channel event content shall be: `Read .glassbox/latest-review.md and apply the feedback.` (or the archive path for non-current reviews).
  - After sending, the button shall show a brief confirmation ("Sent!") before the modal closes.
- When Claude Channel is not enabled or not connected:
  - The "Send to Claude" button shall not appear.
  - The existing "Tell your AI tool" copyable text remains as the fallback.

### 17.5 Channel API Endpoints

- `GET /api/channel/status` — Returns `{ enabled: boolean; connected: boolean }`.
- `POST /api/channel/enable` — Enables the channel and registers in `.mcp.json`.
- `POST /api/channel/disable` — Disables the channel and removes from `.mcp.json`.
- `POST /api/channel/trigger` — Sends a message to Claude via the channel server.
- `GET /api/channel/claude-check` — Checks if Claude Code is installed and returns `{ installed: boolean; version: string | null; meetsMinimum: boolean }`.

## Non-Functional Requirements

### 17.6 Safety

- The channel server shall only listen on `127.0.0.1` (localhost).
- Channel events shall not send any data beyond the review file path.
- The channel server shall not be started unless explicitly enabled by the user.

### 17.7 Graceful Degradation

- If Claude Code is not running or the channel is disconnected, all review functionality shall work normally.
- The channel feature is entirely optional — no functionality depends on it.
