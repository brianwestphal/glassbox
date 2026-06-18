#!/usr/bin/env bash
# CI helper: provision (and tear down) an isolated macOS keychain holding the
# Developer ID certificate so the Apple Foundation Models helper can be
# code-signed during the sidecar build.
#
# Why this exists: the helper (src-tauri/apple-fm-helper/main.swift, compiled by
# scripts/build-apple-fm-helper.sh) is a native Mach-O binary that gets bundled
# under Tauri `resources/**` (via scripts/build-sidecar.sh → server/). Tauri
# signs the main app binary and its `externalBin` sidecars, but it does NOT sign
# arbitrary Mach-O files under `resources/**`. Apple's notary service rejects a
# bundle that contains any unsigned / non-hardened-runtime Mach-O, so the helper
# must be signed with the Developer ID + hardened runtime + a secure timestamp
# BEFORE tauri-action notarizes the app bundle.
#
# Usage (see release-desktop.yml / release-candidate.yml):
#   apple-fm-signing-keychain.sh import    # create keychain + import cert; exports APPLE_FM_KEYCHAIN
#   apple-fm-signing-keychain.sh cleanup   # delete the keychain
#
# Safety: the keychain is referenced explicitly by build-apple-fm-helper.sh via
# `codesign --keychain "$APPLE_FM_KEYCHAIN"`, so the GLOBAL keychain search list
# is never mutated. tauri-action's own signing/notarization keychain is wholly
# unaffected — even if the cleanup step is skipped, the isolated keychain is not
# in the search list and is discarded with the ephemeral runner.
#
# No-ops (exit 0) on non-macOS or when APPLE_CERTIFICATE is unset, so fork PRs
# and secret-less runs still build (the helper is left unsigned — dev only, and
# never notarized).
set -euo pipefail

MODE="${1:-}"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "[apple-fm-sign] not macOS — skipping ($MODE)"
  exit 0
fi

KEYCHAIN="${RUNNER_TEMP:-/tmp}/apple-fm-signing.keychain-db"

case "$MODE" in
  import)
    if [[ -z "${APPLE_CERTIFICATE:-}" ]]; then
      echo "[apple-fm-sign] APPLE_CERTIFICATE unset — helper will build unsigned (dev only)"
      exit 0
    fi

    KC_PW="$(openssl rand -base64 24)"
    CERT="${RUNNER_TEMP:-/tmp}/apple-fm-cert.p12"

    security create-keychain -p "$KC_PW" "$KEYCHAIN"
    # Keep the keychain unlocked for the life of the build (6h ceiling).
    security set-keychain-settings -lut 21600 "$KEYCHAIN"
    security unlock-keychain -p "$KC_PW" "$KEYCHAIN"

    echo "$APPLE_CERTIFICATE" | base64 --decode > "$CERT"
    # -T allowlists the tools permitted to use the key non-interactively.
    security import "$CERT" -k "$KEYCHAIN" -P "${APPLE_CERTIFICATE_PASSWORD:-}" \
      -T /usr/bin/codesign -T /usr/bin/security -f pkcs12
    rm -f "$CERT"

    # Authorize codesign to use the imported private key without a UI prompt.
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KC_PW" "$KEYCHAIN" >/dev/null

    echo "APPLE_FM_KEYCHAIN=$KEYCHAIN" >> "${GITHUB_ENV:-/dev/null}"
    echo "[apple-fm-sign] imported Developer ID cert into isolated keychain $KEYCHAIN"
    ;;
  cleanup)
    if [[ -f "$KEYCHAIN" ]]; then
      security delete-keychain "$KEYCHAIN" || true
      echo "[apple-fm-sign] removed signing keychain $KEYCHAIN"
    else
      echo "[apple-fm-sign] no signing keychain to remove"
    fi
    ;;
  *)
    echo "usage: $0 import|cleanup" >&2
    exit 2
    ;;
esac
