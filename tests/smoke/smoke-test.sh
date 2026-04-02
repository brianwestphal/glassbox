#!/usr/bin/env bash
#
# Smoke test for verifying a glassbox installation works.
# Used by CI after npm install (fresh or upgrade) to verify
# the binary starts, serves pages, and shuts down cleanly.
#
# Usage:
#   ./tests/smoke/smoke-test.sh [glassbox-binary]
#
# The optional argument is the path to the glassbox binary.
# Defaults to "glassbox" (assumes it's on PATH).
#
# Exit codes:
#   0 — all checks passed
#   1 — a check failed
#
set -euo pipefail

GLASSBOX="${1:-glassbox}"
PORT=4199
ORIGINAL_DIR="$(pwd)"
TEST_REPO_URL="https://github.com/brianwestphal/glassbox.git"
TEST_REPO_DIR=""
PASSED=0
FAILED=0
SERVER_PID=""

# --- Helpers ---

BOLD="\033[1m"
GREEN="\033[32m"
RED="\033[31m"
DIM="\033[2m"
RESET="\033[0m"

pass() { echo -e "  ${GREEN}✓${RESET} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}✗${RESET} $1"; FAILED=$((FAILED + 1)); }

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$TEST_REPO_DIR" && -d "$TEST_REPO_DIR" ]]; then
    rm -rf "$TEST_REPO_DIR"
  fi
}
trap cleanup EXIT

# --- Check binary exists ---

echo -e "${BOLD}Smoke Test: ${GLASSBOX}${RESET}"
echo ""

# Check if the command works (handles both single binaries and multi-word commands like "npx tsx src/cli.ts")
if ! $GLASSBOX --help > /dev/null 2>&1; then
  fail "Binary not runnable: $GLASSBOX"
  echo ""
  echo -e "${RED}${BOLD}FAILED${RESET} — binary not accessible"
  exit 1
fi
pass "Binary runnable"

# --- Check --help works ---

HELP_OUTPUT=$($GLASSBOX --help 2>&1 || true)
if echo "$HELP_OUTPUT" | grep -q "Usage:"; then
  pass "--help prints usage"
else
  fail "--help did not print usage info"
fi

# --- Clone test repo ---

echo ""
echo -e "${DIM}Cloning test repo...${RESET}"
TEST_REPO_DIR=$(mktemp -d "${TMPDIR:-/tmp}/glassbox-smoke.XXXXXX")
git clone --depth 50 --quiet "$TEST_REPO_URL" "$TEST_REPO_DIR" 2>/dev/null

# Pick a commit that has changes (not the initial commit)
cd "$TEST_REPO_DIR"
TEST_COMMIT=$(git log --oneline -10 | tail -1 | awk '{print $1}')
if [[ -z "$TEST_COMMIT" ]]; then
  fail "Could not find a test commit"
  exit 1
fi
pass "Test repo cloned, using commit $TEST_COMMIT"

# --- Ensure clean glassbox state ---

rm -rf "$TEST_REPO_DIR/.glassbox"

# --- Start glassbox server ---

echo ""
echo -e "${DIM}Starting glassbox server...${RESET}"
# If GLASSBOX is a relative path (e.g. ./dist/cli.js), resolve it before cd
if [[ "$GLASSBOX" == ./* || "$GLASSBOX" == ../* ]]; then
  GLASSBOX="$ORIGINAL_DIR/$GLASSBOX"
fi
$GLASSBOX --commit "$TEST_COMMIT" --no-open --strict-port --port "$PORT" &
SERVER_PID=$!

# Wait for server to be ready (up to 30 seconds)
READY=false
for i in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT/" > /dev/null 2>&1; then
    READY=true
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    fail "Server process exited unexpectedly"
    break
  fi
  sleep 0.5
done

if [[ "$READY" == "true" ]]; then
  pass "Server started on port $PORT"
else
  fail "Server did not become ready within 30 seconds"
  echo ""
  echo -e "${RED}${BOLD}FAILED${RESET} — $PASSED passed, $FAILED failed"
  exit 1
fi

# --- Verify main page loads ---

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/")
if [[ "$HTTP_STATUS" == "200" ]]; then
  pass "GET / returns 200"
else
  fail "GET / returned $HTTP_STATUS (expected 200)"
fi

# --- Verify page has content ---

PAGE_HTML=$(curl -s "http://localhost:$PORT/")
if echo "$PAGE_HTML" | grep -q "review-app"; then
  pass "Page contains review-app element"
else
  fail "Page missing review-app element"
fi

if echo "$PAGE_HTML" | grep -q "file-list"; then
  pass "Page contains file-list element"
else
  fail "Page missing file-list element"
fi

if echo "$PAGE_HTML" | grep -q "file-item"; then
  pass "Page contains file-item entries"
else
  fail "Page missing file-item entries (no files in review?)"
fi

# --- Verify API returns data ---

API_REVIEW=$(curl -s "http://localhost:$PORT/api/review")
if echo "$API_REVIEW" | grep -q '"id"'; then
  pass "GET /api/review returns review data"
else
  fail "GET /api/review did not return expected data"
fi

API_FILES=$(curl -s "http://localhost:$PORT/api/files")
if echo "$API_FILES" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if len(d)>0 else 1)" 2>/dev/null; then
  FILE_COUNT=$(echo "$API_FILES" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
  pass "GET /api/files returns $FILE_COUNT files"
else
  fail "GET /api/files returned empty or invalid JSON"
fi

# --- Verify history page ---

HISTORY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/history")
if [[ "$HISTORY_STATUS" == "200" ]]; then
  pass "GET /history returns 200"
else
  fail "GET /history returned $HISTORY_STATUS"
fi

# --- Verify static assets ---

CSS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/static/styles.css")
if [[ "$CSS_STATUS" == "200" ]]; then
  pass "Static CSS served"
else
  fail "Static CSS returned $CSS_STATUS"
fi

JS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/static/app.js")
if [[ "$JS_STATUS" == "200" ]]; then
  pass "Static JS served"
else
  fail "Static JS returned $JS_STATUS"
fi

# --- Verify themes API ---

THEMES=$(curl -s "http://localhost:$PORT/api/themes")
if echo "$THEMES" | grep -q '"activeId"'; then
  pass "GET /api/themes returns theme data"
else
  fail "GET /api/themes did not return expected data"
fi

# --- Graceful shutdown ---

echo ""
echo -e "${DIM}Testing graceful shutdown...${RESET}"
kill "$SERVER_PID" 2>/dev/null
WAIT_EXIT=0
wait "$SERVER_PID" 2>/dev/null || WAIT_EXIT=$?
SERVER_PID=""

# Server should exit cleanly (exit code 0 or 143 for SIGTERM)
if [[ "$WAIT_EXIT" -eq 0 || "$WAIT_EXIT" -eq 143 ]]; then
  pass "Server shut down cleanly (exit $WAIT_EXIT)"
else
  fail "Server exited with code $WAIT_EXIT"
fi

# Verify port is freed
sleep 1
if curl -sf "http://localhost:$PORT/" > /dev/null 2>&1; then
  fail "Port $PORT still in use after shutdown"
else
  pass "Port $PORT freed after shutdown"
fi

# --- Summary ---

echo ""
TOTAL=$((PASSED + FAILED))
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}PASSED${RESET} — all $TOTAL checks passed"
  exit 0
else
  echo -e "${RED}${BOLD}FAILED${RESET} — $PASSED passed, $FAILED failed"
  exit 1
fi
