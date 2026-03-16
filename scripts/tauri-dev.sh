#!/bin/bash
# Launch Tauri dev mode, forwarding any extra args (e.g. --all, --staged)
# to the glassbox CLI via the Rust app.
#
# Usage: npm run tauri:dev -- --all
set -e

bash scripts/ensure-sidecar-stub.sh

if [ $# -eq 0 ]; then
  exec tauri dev
else
  # Double -- needed: first ends tauri dev args, second ends cargo run args
  exec tauri dev -- -- "$@"
fi
