#!/usr/bin/env bash
#
# Smoke test for ground-truth mode (doc 26) against the REAL built bundle
# (dist/cli.js), not tsx. The e2e suite boots `tsx src/cli.ts`, so it can't catch
# ESM-bundle-only runtime failures — e.g. GB-976, where a bundled CJS dep (pngjs,
# via the perceptual diff) called `require('util')` and the ESM bundle threw
# "Dynamic require of util is not supported" at launch, crashing the shipped CLI
# even though e2e was green. This runs the bundle end-to-end:
#   launch --ground-truth -> add a region annotation -> complete -> assert the
#   structured JSON export (GB-973) is produced and well-formed.
#
# Exit codes: 0 — all checks passed; 1 — a check failed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/dist/cli.js"
FIXTURES="$ROOT/tests/fixtures/ground-truth"
PORT=4196
PASSED=0
FAILED=0
pass() { echo "  ok   $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  FAIL $1"; FAILED=$((FAILED + 1)); }

echo "Smoke test: ground-truth mode on the built bundle (doc 26 / GB-973 / GB-976)"
echo ""

if [[ ! -f "$CLI" ]]; then
  echo "Building dist/cli.js ..."
  (cd "$ROOT" && npm run build >/dev/null 2>&1)
fi

# Isolated work dir holding a copy of the fixtures + the data dir + export.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/gb-gt-smoke.XXXXXX")"
cp -R "$FIXTURES"/. "$WORK/"
export HOME="$WORK"
case "$(uname -s)" in MINGW* | CYGWIN* | MSYS*) export USERPROFILE="$WORK" ;; esac

SERVER_PID=""
cleanup() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "Launching --ground-truth (--no-open) on $PORT from the bundle ..."
# An --on-complete hook (GB-974) that records the env it received; the assertions
# below confirm it fired exactly once with the JSON export path.
HOOK_MARKER="$WORK/hook-ran.txt"
ON_COMPLETE="printf '%s\n' \"\$GLASSBOX_REVIEW_ID\" \"\$GLASSBOX_REVIEW_JSON\" > '$HOOK_MARKER'"
node "$CLI" --ground-truth "$WORK/manifest.json" --no-open --strict-port --port "$PORT" \
  --on-complete "$ON_COMPLETE" \
  --data-dir "$WORK/.gbdata" --project-dir "$WORK" >"$WORK/srv.log" 2>&1 &
SERVER_PID=$!

# The GB-976 regression manifested as the process exiting at launch — so a server
# that comes up at all already proves the bundle doesn't crash on the pngjs path.
ready=false
for _ in $(seq 1 80); do
  if curl -sf "http://127.0.0.1:$PORT/api/files" 2>/dev/null | grep -q '"files"'; then ready=true; break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "server exited early:"; cat "$WORK/srv.log"; exit 1; }
  sleep 0.25
done
if $ready; then pass "bundle launched ground-truth without crashing (GB-976)"; else fail "server not ready"; cat "$WORK/srv.log"; exit 1; fi

FILES="$(curl -s "http://127.0.0.1:$PORT/api/files")"
echo "$FILES" | grep -q '"actual/widget.png"' && pass "source list has the manifest comparisons" || fail "comparisons missing"

# Add an image-region annotation on the actual (new/B) side of widget.png.
FID="$(printf '%s' "$FILES" | python3 -c "import json,sys; print(next(f['id'] for f in json.load(sys.stdin)['files'] if f['file_path']=='actual/widget.png'))")"
curl -s -X POST "http://127.0.0.1:$PORT/api/annotations" -H "Content-Type: application/json" \
  -d "{\"reviewFileId\":\"$FID\",\"lineNumber\":0,\"side\":\"new\",\"category\":\"bug\",\"content\":\"red stripe should not be here\",\"region\":{\"x\":0,\"y\":0,\"w\":0.25,\"h\":1,\"side\":\"new\"}}" \
  | grep -q '"id"' && pass "image-region annotation created on a repo-less review" || fail "annotation create failed"

# Complete the review — fires the immediate export (markdown + JSON) + the hook.
COMPLETE="$(curl -s -X POST "http://127.0.0.1:$PORT/api/review/complete" -H "Content-Type: application/json" -d '{}')"
echo "$COMPLETE" | grep -q '"status":"completed"' && pass "review completed" || fail "complete failed"
# The response reports the hook outcome (GB-974).
echo "$COMPLETE" | grep -q '"hook":{"ran":true,"ok":true' && pass "complete response reports the hook ran ok" || fail "hook result missing/!ok: $COMPLETE"

kill "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""

# The --on-complete hook (GB-974) fired once with the JSON export path in env.
if [[ -f "$HOOK_MARKER" ]]; then
  pass "on-complete hook ran"
  grep -q "/.glassbox/latest-review.json$" "$HOOK_MARKER" && pass "hook received GLASSBOX_REVIEW_JSON" || fail "hook env missing the JSON path: $(cat "$HOOK_MARKER")"
else
  fail "on-complete hook did not run (no marker)"
fi

# The structured JSON export (GB-973) must exist and be well-formed.
JSON="$WORK/.glassbox/latest-review.json"
[[ -f "$JSON" ]] && pass "latest-review.json written" || fail "latest-review.json missing"
if [[ -f "$JSON" ]]; then
  python3 - "$JSON" <<'PY' && pass "JSON export is valid and shaped as expected" || fail "JSON export malformed"
import json, sys
d = json.load(open(sys.argv[1]))
assert d["schemaVersion"] == 1, "schemaVersion"
# Clean mode label, never the raw serialized mode string (GB-971/GB-973).
assert d["review"]["mode"].startswith("ground truth:"), f"mode label: {d['review']['mode']!r}"
assert "{" not in d["review"]["mode"], "mode label leaked serialized JSON"
assert d["review"]["modeType"] == "ground-truth", "modeType"
comps = d["comparisons"]
assert len(comps) == 1 and comps[0]["path"] == "actual/widget.png", "only the annotated comparison"
gt = comps[0]["groundTruth"]
assert gt and gt["label"] == "Widget" and gt["expectedKind"] == "spec", "ground-truth context"
a = comps[0]["annotations"][0]
assert a["region"]["scope"] == "new" and a["region"]["pixel"] is not None, "region denormalized to pixels"
PY
fi

echo ""
TOTAL=$((PASSED + FAILED))
if [[ "$FAILED" -eq 0 ]]; then
  echo "PASSED — all $TOTAL ground-truth smoke checks passed"
  exit 0
else
  echo "FAILED — $FAILED of $TOTAL ground-truth smoke checks failed"
  exit 1
fi
