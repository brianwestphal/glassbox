#!/bin/bash
# Launch Tauri dev mode, forwarding any extra args (e.g. --all, --staged)
# to the glassbox CLI via the Rust app.
#
# Usage: npm run tauri:dev -- --all
set -e

bash scripts/ensure-sidecar-stub.sh

# Build the Apple Foundation Models helper for dev (doc 22 §22.10). A packaged
# build wires it via build-sidecar.sh + the bundled resource path, but tauri:dev
# spawns the server from source and never built it — so the Apple platform never
# appeared in dev even on a capable machine. The build script is guarded (no-ops
# on non-macOS / missing swiftc / missing the macOS-26 SDK), so this is safe
# everywhere. When it produces a binary, point the dev server at it via
# GLASSBOX_APPLE_FM_BIN: the Rust dev launcher spawns `node … src/cli.ts` as a
# child that inherits this env, and the Node bridge probes it for availability.
# When the build is skipped, the var stays unset and Apple cleanly reports
# unavailable.
bash scripts/build-apple-fm-helper.sh "dist/apple-fm-helper" || true
if [ -f "dist/apple-fm-helper" ]; then
  export GLASSBOX_APPLE_FM_BIN="$(pwd)/dist/apple-fm-helper"
fi

if [ $# -eq 0 ]; then
  exec tauri dev
else
  # Double -- needed: first ends tauri dev args, second ends cargo run args
  exec tauri dev -- -- "$@"
fi
