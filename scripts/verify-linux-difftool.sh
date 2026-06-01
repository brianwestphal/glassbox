#!/usr/bin/env bash
# GB-856 — verify the Linux `git difftool` desktop path against a real .deb.
#
# Builds the Linux bundle in a container, extracts it, and checks the things we
# can verify without a display:
#   1. Every path the Linux launcher shims resolve actually exists in the
#      installed tree (the bug class we just fixed — shims pointed at the wrong
#      dirs).
#   2. The bundled Node + cli.js serve a `--diff` review (the server half of the
#      desktop flow; the Tauri window itself is left to CI under xvfb).
#
# Not part of the normal build. Requires Docker. The full GUI launch is covered
# by the GitHub Actions ubuntu job (see .github/workflows/difftool-linux.yml).
set -euo pipefail
cd "$(dirname "$0")/.."

docker run --rm \
  -v "$PWD":/src \
  -v glassbox-linux-cargo:/root/.cargo/registry \
  -v glassbox-linux-target:/cargo-target \
  -e CARGO_TARGET_DIR=/cargo-target \
  -w /work ubuntu:22.04 bash -euo pipefail -c '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl build-essential libwebkit2gtk-4.1-dev librsvg2-dev patchelf file git ca-certificates >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
  curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal >/dev/null 2>&1
  . "$HOME/.cargo/env"

  cp -a /src/. /work/
  rm -rf /work/node_modules /work/src-tauri/target
  npm ci --no-audit --no-fund >/dev/null 2>&1

  TARGET=$(rustc --print host-tuple)
  echo ">>> building sidecar for $TARGET"
  bash scripts/build-sidecar.sh "$TARGET" >/dev/null

  echo ">>> building tauri deb"
  npm run tauri build -- --bundles deb >/tmp/tauri-build.log 2>&1 || true
  DEB=$(find /cargo-target -name "*.deb" | head -1)
  if [ -z "$DEB" ]; then echo "FAIL: no .deb produced"; tail -40 /tmp/tauri-build.log; exit 1; fi

  ROOT=/tmp/deb-extract
  rm -rf "$ROOT"; mkdir -p "$ROOT"
  dpkg-deb -x "$DEB" "$ROOT"

  fail=0
  check() { if [ -e "$1" ]; then echo "  ok   $2 -> $1"; else echo "  FAIL $2 -> $1 (missing)"; fail=1; fi; }

  echo ">>> 1. shim path resolution (resolved from the extracted tree)"
  RES="$ROOT/usr/lib/Glassbox/resources"
  APP_ROOT="$ROOT/usr/lib/Glassbox"
  BIN_DIR="$ROOT/usr/bin"
  echo " glassbox-linux:"
  check "$BIN_DIR/glassbox-node"            "NODE_BIN"
  check "$BIN_DIR/glassbox"                 "TAURI_BIN"
  check "$APP_ROOT/server/cli.js"           "CLI_JS"
  echo " glassbox-difftool-linux:"
  check "$BIN_DIR/glassbox-node"            "NODE_BIN"
  check "$APP_ROOT/server/cli-difftool.js"  "CLI_DIFFTOOL_JS"

  # Re-derive the same way the shims do (readlink + ../../../bin) and confirm it
  # lands on the real binaries — catches drift between the shim math and reality.
  echo ">>> 2. shim relative-path math matches the layout"
  SHIM="$RES/glassbox-linux"
  D="$(dirname "$(readlink -f "$SHIM")")"
  RESOLVED_BIN="$(cd "$D/../../../bin" && pwd)"
  check "$RESOLVED_BIN/glassbox"            "glassbox-linux ../../../bin/glassbox"
  check "$D/../server/cli.js"               "glassbox-linux ../server/cli.js"

  echo ">>> 3. bundled Node serves a --diff review"
  mkdir -p /tmp/L /tmp/R
  printf "a\nb\nc\n" > /tmp/L/f.txt
  printf "a\nX\nc\n" > /tmp/R/f.txt
  "$BIN_DIR/glassbox-node" "$APP_ROOT/server/cli.js" --diff /tmp/L /tmp/R --no-open --port 4321 --strict-port > /tmp/srv.log 2>&1 &
  SRV=$!
  for i in $(seq 1 80); do grep -q "running at" /tmp/srv.log && break; kill -0 $SRV 2>/dev/null || break; sleep 0.25; done
  if grep -q "running at" /tmp/srv.log; then
    CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/ || echo 000)
    if [ "$CODE" = "200" ]; then echo "  ok   server responded 200"; else echo "  FAIL server HTTP $CODE"; fail=1; fi
    RID=$(grep -oE "Review [a-z0-9]+ created" /tmp/srv.log | awk "{print \$2}" | head -1)
    FILES=$(curl -s "http://localhost:4321/api/files?reviewId=$RID" || true)
    if echo "$FILES" | grep -q "f.txt"; then echo "  ok   diff review contains f.txt"; else echo "  FAIL diff review empty: $(echo "$FILES" | head -c 120)"; fail=1; fi
  else
    echo "  FAIL server did not start"; tail -20 /tmp/srv.log; fail=1
  fi
  kill $SRV 2>/dev/null || true

  echo "========================================================"
  if [ "$fail" = 0 ]; then echo "PASS: Linux difftool paths + server verified"; else echo "FAIL: see above"; exit 1; fi
'
