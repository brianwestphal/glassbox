#!/bin/bash
# Build the Tauri sidecar: a Node.js binary + server bundle.
#
# PGLite requires filesystem access to its WASM/data files at runtime,
# which breaks single-binary compilers (pkg, bun compile). Instead, we
# bundle a Node.js binary as the sidecar and include the server code +
# node_modules as Tauri resources.
#
# Usage:
#   bash scripts/build-sidecar.sh                          # builds for current host
#   bash scripts/build-sidecar.sh aarch64-apple-darwin      # builds for specific target
set -e

NODE_VERSION="v20.19.0"
TARGET="${1:-$(rustc --print host-tuple 2>/dev/null || echo "unknown")}"

# Map Rust target triple to Node.js download target
case "$TARGET" in
  aarch64-apple-darwin)       NODE_PLATFORM="darwin-arm64" ;;
  x86_64-apple-darwin)        NODE_PLATFORM="darwin-x64" ;;
  x86_64-pc-windows-msvc)     NODE_PLATFORM="win-x64" ;;
  x86_64-unknown-linux-gnu)   NODE_PLATFORM="linux-x64" ;;
  aarch64-unknown-linux-gnu)  NODE_PLATFORM="linux-arm64" ;;
  *)
    echo "Unsupported target: $TARGET"
    exit 1
    ;;
esac

EXT=""
if [[ "$TARGET" == *"windows"* ]]; then
  EXT=".exe"
fi

SIDECAR="src-tauri/binaries/glassbox-node-${TARGET}${EXT}"
SERVER_DIR="src-tauri/server"

echo "Building sidecar for $TARGET..."

# --- Step 1: Build the TypeScript server bundle ---
npm run build

# Build first-party content plugins (doc 29, GB-1039) into dist/plugins/<id>/.
# Self-contained esbuild bundles (deps inlined), copied into the sidecar below so
# they can be auto-installed into ~/.glassbox/plugins/ at startup. Runs AFTER the
# tsup build (which cleans dist/) so dist/plugins survives.
npm run build:plugins

# --- Step 2: Download Node.js binary for the target platform ---
mkdir -p src-tauri/binaries

# Check if a real Node binary exists (not the dev-mode stub).
# The stub from ensure-sidecar-stub.sh is ~100 bytes; a real Node binary is >40MB.
NEED_DOWNLOAD=true
if [ -f "$SIDECAR" ]; then
  FILESIZE=$(wc -c < "$SIDECAR" | tr -d ' ')
  if [ "$FILESIZE" -gt 1000000 ]; then
    NEED_DOWNLOAD=false
  else
    echo "Removing dev-mode stub..."
    rm -f "$SIDECAR"
  fi
fi

if [ "$NEED_DOWNLOAD" = true ]; then
  echo "Downloading Node.js $NODE_VERSION for $NODE_PLATFORM..."

  if [[ "$TARGET" == *"windows"* ]]; then
    ARCHIVE="node-${NODE_VERSION}-${NODE_PLATFORM}.zip"
    curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${ARCHIVE}" -o "/tmp/${ARCHIVE}"
    unzip -jo "/tmp/${ARCHIVE}" "node-${NODE_VERSION}-${NODE_PLATFORM}/node.exe" -d src-tauri/binaries/
    mv "src-tauri/binaries/node.exe" "$SIDECAR"
    rm "/tmp/${ARCHIVE}"
  else
    ARCHIVE="node-${NODE_VERSION}-${NODE_PLATFORM}.tar.gz"
    curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${ARCHIVE}" -o "/tmp/${ARCHIVE}"
    tar -xzf "/tmp/${ARCHIVE}" -C /tmp "node-${NODE_VERSION}-${NODE_PLATFORM}/bin/node"
    mv "/tmp/node-${NODE_VERSION}-${NODE_PLATFORM}/bin/node" "$SIDECAR"
    rm -rf "/tmp/${ARCHIVE}" "/tmp/node-${NODE_VERSION}-${NODE_PLATFORM}"
  fi

  chmod +x "$SIDECAR"
  echo "Node.js binary: $SIDECAR ($(du -h "$SIDECAR" | cut -f1))"
else
  echo "Node.js binary already exists: $SIDECAR"
fi

# --- Step 3: Bundle the server code + production node_modules ---
echo "Bundling server resources..."
rm -rf "$SERVER_DIR"
mkdir -p "$SERVER_DIR"

# Copy the built server bundle and client assets
cp dist/cli.js "$SERVER_DIR/"
# `glassbox-difftool` wrapper — resolves `cli.js` as a sibling via
# `import.meta.url`, so it MUST sit next to cli.js. Forgetting this turns
# `git difftool` into "command not found" for desktop-install users
# (GB-853).
cp dist/cli-difftool.js "$SERVER_DIR/"
# Claude Code MCP channel server — spawned by Claude Code via `.mcp.json`.
# `channel-config.ts` (bundled into cli.js) resolves it as a sibling of cli.js
# via `import.meta.url`, so it MUST sit next to cli.js. Forgetting this makes the
# Claude channel toggle write a `.mcp.json` pointing at a non-existent file, so
# the channel silently fails to launch in desktop installs (GB-887).
cp dist/channel.js "$SERVER_DIR/"
# Apple Foundation Models helper (doc 22) — the on-device AI provider. We no
# longer compile our own Swift helper: the `apple-fm` runtime dependency ships a
# Developer-ID signed + notarized arm64 helper at
# `node_modules/apple-fm/bin/apple-fm-helper`, which the `apple-fm` library
# resolves relative to its own package. Copying the `apple-fm` package below (in
# the external-deps loop) brings that helper along, so there is nothing to build
# here — the bundle build works on the macOS-15 runner with no macOS-26 SDK. On
# any non-macOS / non-arm64 bundle the helper simply never runs (apple-fm's probe
# reports `unsupportedPlatform`) and the Apple platform stays hidden.
mkdir -p "$SERVER_DIR/client"
cp dist/client/app.global.js "$SERVER_DIR/client/"
cp dist/client/history.global.js "$SERVER_DIR/client/"
cp dist/client/styles.css "$SERVER_DIR/client/"
cp dist/client/favicon.svg "$SERVER_DIR/client/"

# Bundled first-party content plugins (doc 29, GB-1039). Copied next to cli.js so
# `bundledPluginsDir()` resolves them (server/plugins) and `installBundledPlugins`
# seeds ~/.glassbox/plugins/ at startup. Optional: absent if no plugins built.
if [ -d dist/plugins ]; then
  cp -R dist/plugins "$SERVER_DIR/plugins"
  echo "Bundled content plugins: $(ls dist/plugins | tr '\n' ' ')"
fi

# Copy only the external runtime dependencies (those kept external by tsup's
# noExternal regex). Must stay in sync with that regex and CLAUDE.md's
# external-deps list — see tests/unit/build-sidecar-externals.test.ts, which
# fails if a tsup-external package is missing here. @modelcontextprotocol/sdk is
# required by the channel server (dist/channel.js); @preact/signals-core is a
# transitive dep of kerfjs; apple-fm carries the on-device helper binary that its
# library resolves relative to its own package, so it must stay external.
for pkg in @electric-sql/pglite hono @hono/node-server @modelcontextprotocol/sdk kerfjs @preact/signals-core apple-fm; do
  dest="$SERVER_DIR/node_modules/$pkg"
  mkdir -p "$(dirname "$dest")"
  cp -R "node_modules/$pkg" "$dest"
done

# Re-sign the bundled Apple FM helper with our Developer ID + hardened runtime
# when a signing identity is available (the same secret Tauri uses for the app —
# see the release workflows). apple-fm ships it signed + notarized already, but
# re-signing under our identity keeps the app bundle's signature self-consistent
# so the later notarization of the whole bundle covers it. codesign needs no
# macOS-26 SDK, so this runs fine on the macOS-15 bundle runner. Locally the var
# is unset and the helper keeps apple-fm's own valid signature.
APPLE_FM_HELPER="$SERVER_DIR/node_modules/apple-fm/bin/apple-fm-helper"
APPLE_FM_SIGN_ID="${APPLE_SIGNING_IDENTITY:-${CODESIGN_IDENTITY:-}}"
if [[ "$(uname)" == "Darwin" && -f "$APPLE_FM_HELPER" && -n "$APPLE_FM_SIGN_ID" ]]; then
  chmod +x "$APPLE_FM_HELPER"
  codesign --force --options runtime --timestamp --sign "$APPLE_FM_SIGN_ID" "$APPLE_FM_HELPER"
  echo "Re-signed Apple FM helper with $APPLE_FM_SIGN_ID"
fi

echo "Server resources: $SERVER_DIR/ ($(du -sh "$SERVER_DIR" | cut -f1))"
echo "Done."
