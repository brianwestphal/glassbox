#!/usr/bin/env bash
# Compile (+ optionally code-sign) the Apple Foundation Models helper used by the
# on-device AI provider (src-tauri/apple-fm-helper/main.swift; doc 22).
#
# GUARDED so it can be called from any build without breaking it: it no-ops with
# exit 0 on non-macOS, when swiftc is missing, or when the macOS 26 SDK isn't
# present (FoundationModels). On a capable machine it emits the helper binary at
# $1 (default dist/apple-fm-helper); build-sidecar.sh copies that next to cli.js
# and the launcher points the server at it via GLASSBOX_APPLE_FM_BIN
# (see docs/tauri-architecture.md).
#
# Code-signing: reuses the repo's macOS signing identity. Set APPLE_SIGNING_IDENTITY
# (the same secret Tauri uses for the app bundle — see the release workflows) to
# sign the helper with hardened runtime; the helper must be signed + notarized
# along with the bundle to run on other machines. Falls back to CODESIGN_IDENTITY.
set -euo pipefail

OUT="${1:-dist/apple-fm-helper}"
SRC="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/apple-fm-helper/main.swift"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "[apple-fm] not macOS — skipping helper build"; exit 0
fi
if ! command -v swiftc >/dev/null 2>&1; then
  echo "[apple-fm] swiftc not found — skipping helper build"; exit 0
fi
if [[ ! -f "$SRC" ]]; then
  echo "[apple-fm] source missing ($SRC) — skipping"; exit 0
fi

mkdir -p "$(dirname "$OUT")"

# Apple Intelligence is arm64-only; needs the macOS 26 SDK for FoundationModels.
if ! swiftc -O -target arm64-apple-macos26 "$SRC" -o "$OUT" 2>/tmp/apple-fm-build.log; then
  echo "[apple-fm] build failed (needs the macOS 26 SDK / Xcode 26) — skipping:"
  sed 's/^/[apple-fm]   /' /tmp/apple-fm-build.log || true
  exit 0
fi

SIGN_ID="${APPLE_SIGNING_IDENTITY:-${CODESIGN_IDENTITY:-}}"
if [[ -n "$SIGN_ID" ]]; then
  codesign --force --options runtime --timestamp --sign "$SIGN_ID" "$OUT"
  echo "[apple-fm] signed with $SIGN_ID"
else
  echo "[apple-fm] no APPLE_SIGNING_IDENTITY — built unsigned (dev only)"
fi

echo "[apple-fm] built $OUT"
