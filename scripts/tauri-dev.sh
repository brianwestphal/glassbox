#!/bin/bash
# Launch Tauri dev mode, forwarding any extra args (e.g. --all, --staged)
# to the glassbox CLI via the Rust app.
#
# Usage: npm run tauri:dev -- --all
set -e

bash scripts/ensure-sidecar-stub.sh

# The on-device Apple Foundation Models provider (doc 22) now comes from the
# `apple-fm` dependency, which ships its own helper binary. In dev the server
# runs from source and `apple-fm` resolves its bundled `bin/apple-fm-helper`
# straight from the project's `node_modules`, so there's nothing to build or wire
# here — the Apple platform appears in `tauri:dev` automatically on a capable
# macOS-26 machine, and cleanly reports unavailable everywhere else.

if [ $# -eq 0 ]; then
  exec tauri dev
else
  # Double -- needed: first ends tauri dev args, second ends cargo run args
  exec tauri dev -- -- "$@"
fi
