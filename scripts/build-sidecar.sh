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
# SVG rasterization worker — spawned by cli.js as a sibling worker thread.
# Must sit next to cli.js so `new URL('./svg-rasterize-worker.js', import.meta.url)`
# resolves at runtime; forgetting this makes SVG image-diff rasterization fall
# back to blocking in-process rendering.
cp dist/svg-rasterize-worker.js "$SERVER_DIR/"
# Claude Code MCP channel server — spawned by Claude Code via `.mcp.json`.
# `channel-config.ts` (bundled into cli.js) resolves it as a sibling of cli.js
# via `import.meta.url`, so it MUST sit next to cli.js. Forgetting this makes the
# Claude channel toggle write a `.mcp.json` pointing at a non-existent file, so
# the channel silently fails to launch in desktop installs (GB-887).
cp dist/channel.js "$SERVER_DIR/"
# Apple Foundation Models helper (doc 22) — the on-device AI provider's Swift
# CLI. The build is GUARDED (no-op off macOS / missing swiftc / missing macOS-26
# SDK), so this is a clean skip on Linux/Windows/CI without Xcode 26. When it
# does build, the binary sits next to cli.js and the launcher points the server
# at it via GLASSBOX_APPLE_FM_BIN.
bash "$(dirname "$0")/build-apple-fm-helper.sh" "dist/apple-fm-helper" || true
if [[ -f "dist/apple-fm-helper" ]]; then
  cp dist/apple-fm-helper "$SERVER_DIR/apple-fm-helper"
  chmod +x "$SERVER_DIR/apple-fm-helper"
  echo "Bundled Apple FM helper into $SERVER_DIR/"
fi
mkdir -p "$SERVER_DIR/client"
cp dist/client/app.global.js "$SERVER_DIR/client/"
cp dist/client/history.global.js "$SERVER_DIR/client/"
cp dist/client/styles.css "$SERVER_DIR/client/"

# Copy only the external runtime dependencies (those kept external by tsup's
# noExternal regex). Must stay in sync with that regex and CLAUDE.md's
# external-deps list — see tests/unit/build-sidecar-externals.test.ts, which
# fails if a tsup-external package is missing here. @modelcontextprotocol/sdk is
# required by the channel server (dist/channel.js); @preact/signals-core is a
# transitive dep of kerfjs.
for pkg in @electric-sql/pglite hono @hono/node-server @resvg/resvg-wasm @modelcontextprotocol/sdk kerfjs @preact/signals-core; do
  dest="$SERVER_DIR/node_modules/$pkg"
  mkdir -p "$(dirname "$dest")"
  cp -R "node_modules/$pkg" "$dest"
done

echo "Server resources: $SERVER_DIR/ ($(du -sh "$SERVER_DIR" | cut -f1))"
echo "Done."
