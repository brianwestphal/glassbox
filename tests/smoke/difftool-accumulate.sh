#!/usr/bin/env bash
#
# Smoke test for the accumulating `git difftool` model (doc 19,
# FR-19.3 / 19.7 / 19.8 / 19.6 / GB-864).
#
# Exercises the REAL built wrapper binary (`dist/cli-difftool.js`) against a REAL
# detached accumulating server (`glassbox --difftool-serve`) over loopback HTTP:
# two per-file invocations — the way git drives the tool, with two single files
# and GIT_DIFF_PATH_COUNTER/TOTAL set — must pile into ONE review, each labeled
# by its repo-relative `$MERGED` path, and POST /end must tear the server down.
#
# No browser and no hang: a `--no-open` server is pre-started so the wrapper
# discovers it (instead of spawning its own browser-opening one), and both
# invocations are non-last (COUNTER < TOTAL) so neither triggers the hold.
#
# Exit codes: 0 — all checks passed; 1 — a check failed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/dist/cli.js"
WRAPPER="$ROOT/dist/cli-difftool.js"
PORT=4197
PASSED=0
FAILED=0
pass() { echo "  ok   $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  FAIL $1"; FAILED=$((FAILED + 1)); }

echo "Smoke test: accumulating git difftool (doc 19)"
echo ""

# Build the server + wrapper if they aren't present (before HOME is overridden,
# so npm's real cache is used).
if [[ ! -f "$CLI" || ! -f "$WRAPPER" ]]; then
  echo "Building dist/cli.js + dist/cli-difftool.js ..."
  (cd "$ROOT" && npm run build >/dev/null 2>&1)
fi

# Isolated fake HOME so the discovery lockfile (~/.glassbox/difftool.lock) and the
# data dir never touch the real home or a live difftool session on this machine.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/gb-difftool-smoke.XXXXXX")"
export HOME="$WORK"
case "$(uname -s)" in MINGW* | CYGWIN* | MSYS*) export USERPROFILE="$WORK" ;; esac

SERVER_PID=""
cleanup() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "Starting accumulating server (--difftool-serve, --no-open) on $PORT ..."
node "$CLI" --difftool-serve --no-open --strict-port --port "$PORT" --data-dir "$WORK/data" >"$WORK/srv.log" 2>&1 &
SERVER_PID=$!

ready=false
for _ in $(seq 1 80); do
  if curl -sf "http://127.0.0.1:$PORT/api/difftool/ping" 2>/dev/null | grep -q '"active":true'; then ready=true; break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "server exited early:"; cat "$WORK/srv.log"; exit 1; }
  sleep 0.25
done
if $ready; then pass "accumulating server ready"; else fail "server not ready"; cat "$WORK/srv.log"; exit 1; fi

# Per-file invocations of the REAL wrapper, exactly as git drives it: two single
# temp files plus the repo-relative path as $MERGED, none marked last. The third
# is an ADDED file, where git passes `/dev/null` as $LOCAL — the GB-1000 case
# (`git difftool --cached` over a staged new file). `/dev/null` is not a regular
# file, so the wrapper must still treat it as a per-file append (accumulate),
# NOT misroute it to the blocking dir-diff launch ("one file at a time").
printf 'alpha-old\n' >"$WORK/old1"; printf 'alpha-new\n' >"$WORK/new1"
printf 'beta-old\n'  >"$WORK/old2"; printf 'beta-new\n'  >"$WORK/new2"
printf 'gamma-new\n' >"$WORK/new3"

GIT_DIFF_PATH_COUNTER=1 GIT_DIFF_PATH_TOTAL=4 node "$WRAPPER" "$WORK/old1" "$WORK/new1" "src/alpha.ts"
GIT_DIFF_PATH_COUNTER=2 GIT_DIFF_PATH_TOTAL=4 node "$WRAPPER" "$WORK/old2" "$WORK/new2" "src/beta.ts"
# Added file: $LOCAL is /dev/null. A blocking launch here would hang this script.
GIT_DIFF_PATH_COUNTER=3 GIT_DIFF_PATH_TOTAL=4 node "$WRAPPER" "/dev/null" "$WORK/new3" "src/gamma.ts"

# All three files must have accumulated into the one active review, labeled by path.
POLL="$(curl -s "http://127.0.0.1:$PORT/api/difftool/poll")"
echo "$POLL" | grep -q '"active":true'    && pass "session active after appends"            || fail "session not active"
echo "$POLL" | grep -q '"src/alpha.ts"'   && pass "alpha labeled by repo-relative path"     || fail "alpha missing/mislabeled"
echo "$POLL" | grep -q '"src/beta.ts"'    && pass "beta labeled by repo-relative path"      || fail "beta missing/mislabeled"
echo "$POLL" | grep -q '"src/gamma.ts"'   && pass "added file (/dev/null \$LOCAL) accumulated — GB-1000" || fail "added file missing (GB-1000 regression)"
COUNT=$(echo "$POLL" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('files',[])))" 2>/dev/null || echo "?")
[[ "$COUNT" == "3" ]] && pass "exactly 3 files in one review" || fail "expected 3 files, got $COUNT"

# The "Done"/Ctrl-C end path: POST /end releases holds and tears the server down.
curl -s -X POST "http://127.0.0.1:$PORT/api/difftool/end" >/dev/null
gone=false
for _ in $(seq 1 50); do kill -0 "$SERVER_PID" 2>/dev/null || { gone=true; break; }; sleep 0.1; done
if $gone; then pass "server tore down after /end"; else fail "server still running after /end"; fi
SERVER_PID=""

echo ""
TOTAL=$((PASSED + FAILED))
if [[ "$FAILED" -eq 0 ]]; then
  echo "PASSED — all $TOTAL difftool smoke checks passed"
  exit 0
else
  echo "FAILED — $PASSED passed, $FAILED failed"
  exit 1
fi
