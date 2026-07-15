# Mermaid plugin for Glassbox

Renders Mermaid `.mmd` / `.mermaid` source to SVG in the Glassbox diff viewer and
in review-note artifacts (doc 29 content plugins).

## Why this one is different

Mermaid is fundamentally a **browser** library — it measures text with the DOM
(`getBBox`), so there is no pure-JS or WASM engine (unlike the Graphviz plugin's
`@viz-js/viz`). Every maintained Node renderer drives a **headless browser**; the
canonical one is `@mermaid-js/mermaid-cli` (`mmdc`) over puppeteer/Chromium.

So — mirroring the PlantUML plugin's `java -jar` approach — this plugin renders by
spawning a **local** `mmdc` subprocess. That keeps rendering **offline /
local-first** (nothing is sent to a network render service), but it means the
plugin has **system requirements** (a headless browser) and is therefore
**separately installable** — it is *not* auto-installed with Glassbox
(`autoInstall: false`), so nobody is forced to have Chromium.

## Requirements

- **`@mermaid-js/mermaid-cli` + puppeteer** installed into the plugin's install
  directory (done by the setup helper; puppeteer downloads a Chromium ~hundreds
  of MB, not committed to this repo or shipped in the app bundle).

## Install

```bash
npm run build:plugins           # builds dist/plugins/mermaid/
node plugins/mermaid/setup.mjs  # installs the plugin + mermaid-cli + puppeteer/Chromium
```

`setup.mjs` installs into `~/.glassbox/plugins/mermaid/` (honoring
`GLASSBOX_CONFIG_DIR`) and runs `npm install` for `@mermaid-js/mermaid-cli` +
`puppeteer` there. Pin versions with `MERMAID_CLI_VERSION` / `PUPPETEER_VERSION`.
Restart Glassbox afterward.

### Locked-down / rootless environments

If Chromium refuses to launch under a sandbox (e.g. running as root, or in a
container), point `MERMAID_PUPPETEER_CONFIG` at a JSON file passed through to
`mmdc -p`, for example:

```json
{ "args": ["--no-sandbox"] }
```

You can also override the CLI entry entirely with `MERMAID_MMDC=/path/to/cli.js`.

## Fallback

If `mmdc` isn't installed, or a diagram fails to render, the renderer returns an
empty view and Glassbox shows its normal **code-block** view of the `.mmd`
source — so the file is always readable, plugin or not.
