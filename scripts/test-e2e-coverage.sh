#!/bin/bash
# Run E2E tests with V8 coverage collection on both the server process
# and the browser (via Playwright coverage API).
# Manages the server lifecycle directly (instead of Playwright's webServer)
# so the server exits cleanly and writes V8 coverage data.
set -e

COVERAGE_DIR="${1:-.coverage-tmp/e2e-v8}"
mkdir -p "$COVERAGE_DIR"

# Disposable global-config dir: same GB-923 isolation the playwright.config
# main webServer uses — without it this coverage run reads the developer's real
# ~/.glassbox (whose platform/theme make settings tests fail machine-dependently).
CONFIG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/glassbox-e2e-cov-config.XXXXXX")"
trap 'rm -rf "$CONFIG_DIR"' EXIT

# Pre-flight: the readiness probe below can't distinguish our server from a
# leftover one already bound to 4183 — a stale orphan would silently serve the
# whole suite with foreign config/data. Fail loudly instead.
if curl -sf http://localhost:4183 > /dev/null 2>&1; then
  echo "Port 4183 is already serving — kill the stale server first (lsof -ti tcp:4183 | xargs kill)" >&2
  exit 1
fi

# Start server with V8 coverage. Mirrors the playwright.config main webServer
# command exactly (--ai-service-test keeps the suite hermetic — no real AI
# calls, no API-key dependence).
NODE_V8_COVERAGE="$COVERAGE_DIR" GLASSBOX_CONFIG_DIR="$CONFIG_DIR" \
  npx tsx src/cli.ts --demo:4 --ai-service-test --no-open --strict-port --port 4183 &
SERVER_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -sf http://localhost:4183 > /dev/null 2>&1; then
    break
  fi
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "Server process exited unexpectedly" >&2
    exit 1
  fi
  sleep 0.5
done

# Run Playwright tests. SKIP_WEBSERVER drops only the main 4183 entry from the
# config's webServer list (this script owns that server, above); the auxiliary
# per-project servers (4184/4185/4187) still start via the config, inheriting
# NODE_V8_COVERAGE so their server-side coverage is collected opportunistically.
# `|| TEST_EXIT=$?` keeps `set -e` from aborting the script on test failure —
# without it a failing suite skipped the kill below and leaked the server, so
# the NEXT run bound EADDRINUSE and silently tested against the stale orphan.
TEST_EXIT=0
SKIP_WEBSERVER=1 NODE_V8_COVERAGE="$COVERAGE_DIR" E2E_BROWSER_COVERAGE="$COVERAGE_DIR" npx playwright test || TEST_EXIT=$?

# Stop server gracefully so V8 coverage is written on exit
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null || true

exit $TEST_EXIT
