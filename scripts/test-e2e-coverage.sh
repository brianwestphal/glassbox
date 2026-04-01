#!/bin/bash
# Run E2E tests with V8 coverage collection on the server process.
# Manages the server lifecycle directly (instead of Playwright's webServer)
# so the server exits cleanly and writes V8 coverage data.
set -e

COVERAGE_DIR="${1:-.coverage-tmp/e2e-v8}"
mkdir -p "$COVERAGE_DIR"

# Start server with V8 coverage
NODE_V8_COVERAGE="$COVERAGE_DIR" npx tsx src/cli.ts --demo:4 --no-open --strict-port --port 4183 &
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

# Run Playwright tests (server already running)
SKIP_WEBSERVER=1 npx playwright test
TEST_EXIT=$?

# Stop server gracefully so V8 coverage is written on exit
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null || true

exit $TEST_EXIT
