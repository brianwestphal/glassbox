#!/bin/bash
# Creates a placeholder sidecar binary for Tauri dev mode.
# In dev mode, the Node server runs via beforeDevCommand (not the sidecar),
# but Tauri's build script still requires the externalBin path to exist.
set -e

TARGET="$(rustc --print host-tuple 2>/dev/null || echo "aarch64-apple-darwin")"
STUB="src-tauri/binaries/glassbox-node-${TARGET}"

if [ ! -f "$STUB" ]; then
  mkdir -p src-tauri/binaries
  printf '#!/bin/sh\necho "This is a dev-mode stub. The real Node binary is downloaded by scripts/build-sidecar.sh"\nexit 1\n' > "$STUB"
  chmod +x "$STUB"
fi
