#!/bin/bash
# Creates placeholder Tauri bundle resources for non-bundling builds (dev mode
# via scripts/tauri-dev.sh, and the Rust lint/test gate in CI).
#
# In these flows the Node server runs from source (beforeDevCommand) or isn't
# run at all (clippy/test), so the real sidecar + server bundle are never built.
# But build.rs declares the app commands via tauri-build's AppManifest (needed so
# the localhost WebView can be granted them under Tauri 2.11), which makes
# tauri-build fully resolve the bundle config and validate that:
#   - the externalBin path `binaries/glassbox-node-<triple>` exists, and
#   - the `resources` glob `server/**/*` matches at least one file.
# Without these placeholders build.rs panics ("resource path ... doesn't exist"
# / "glob pattern server/**/* ... didn't match any files"). The real artifacts
# are produced by scripts/build-sidecar.sh for actual packaging (which does NOT
# run this script), so these placeholders never ship in an official build.
set -e

TARGET="$(rustc --print host-tuple 2>/dev/null || echo "aarch64-apple-darwin")"
STUB="src-tauri/binaries/glassbox-node-${TARGET}"

if [ ! -f "$STUB" ]; then
  mkdir -p src-tauri/binaries
  printf '#!/bin/sh\necho "This is a dev-mode stub. The real Node binary is downloaded by scripts/build-sidecar.sh"\nexit 1\n' > "$STUB"
  chmod +x "$STUB"
fi

# Satisfy the `server/**/*` bundle resource glob. The placeholder must NOT be a
# dotfile: the `glob` crate's `*` won't match a leading dot, so `server/.keep`
# wouldn't satisfy the glob. Only create it when server/ is empty/missing so a
# real bundle (from build-sidecar.sh) is never overwritten.
SERVER_DIR="src-tauri/server"
if [ -z "$(ls -A "$SERVER_DIR" 2>/dev/null)" ]; then
  mkdir -p "$SERVER_DIR"
  printf 'Dev/lint placeholder so the server/**/* bundle resource glob resolves. The real server bundle is produced by scripts/build-sidecar.sh.\n' > "$SERVER_DIR/placeholder"
fi
