#!/usr/bin/env bash
# Run the Playwright e2e suite inside the same Linux container CI uses, so a
# local sweep reproduces CI failures faithfully — including failures that only
# show up where no developer conveniences exist. The CI runner is
# `ubuntu-latest` (currently Noble) with Chromium installed via `npx playwright
# install`; the `mcr.microsoft.com/playwright:vX.Y.Z-noble` image matches that
# exactly (Microsoft ships one image per Playwright version, pinned to the same
# browser binaries the npm install would fetch).
#
# Why this is worth having: the e2e suite spins up the real server in demo mode
# and a real browser, so anything environment-dependent — a missing API key (no
# macOS keychain inside the container), case-sensitive paths, Linux-only font
# metrics, /dev/shm size — behaves like CI rather than like your laptop. A pass
# here is a much stronger signal than a local macOS pass that the release
# `test-e2e` gate will be green.
#
# Usage:
#   bash scripts/test-e2e-docker.sh                       # full e2e suite
#   bash scripts/test-e2e-docker.sh stability.test.ts     # one spec
#   bash scripts/test-e2e-docker.sh -g "sort-mode"        # by grep
#
# Requires Docker (Desktop or engine) running. The repo is mounted read-write
# so test artifacts (test-results/, playwright-report/) land back in your
# working tree.

set -euo pipefail

cd "$(dirname "$0")/.."

# Resolve the Playwright version the package is locked to so the image always
# matches — no drift between local and CI.
PW_VERSION=$(node -p "require('./package.json').devDependencies['@playwright/test'].replace(/^[\^~]/, '')")
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"

echo ">>> Image: ${IMAGE}"
echo ">>> CWD:   $(pwd)"
echo

# Pull lazily (no-op if already cached). Streamed so the first run shows
# progress.
docker pull "${IMAGE}"

# Only allocate a TTY when stdin is one — keeps the script usable from another
# script / CI where `-it` would fail with "the input device is not a TTY". A
# scalar (not an array) so it's safe under `set -u` on macOS's bash 3.2, where
# expanding an empty array trips nounset.
TTY_FLAG=
[ -t 0 ] && TTY_FLAG=-it

# `--ipc=host` per Playwright docs — Chromium needs more shared memory than the
#   default 64 MB or pages crash mid-test.
# `--init` so Ctrl-C / signals terminate cleanly.
# `-v "$(pwd):/work"` mounts the repo so results flow back to the host.
# `-v /work/node_modules` is an ANONYMOUS volume that shadows the bind-mounted
#   node_modules: `npm ci` inside the container installs Linux-native binaries
#   (esbuild, rollup, …), and without this they would overwrite the host's
#   macOS binaries in the mount and break local `npm` until a reinstall. The
#   anonymous volume keeps the container's node_modules isolated; the host's is
#   untouched. With `--rm` the volume is discarded on exit.
# `-v glassbox-pw-npm-cache:/tmp/.npm` persists the npm cache across runs so the
#   per-run `npm ci` into the fresh node_modules volume stays fast.
# `-e HOME=/tmp` so npm / tsx / PGLite write to a writable dir (PGLite data
#   lands in /tmp/.glassbox inside the container).
# `-e CI=true` so npm + Playwright pick CI defaults (no progress bars, etc.).
# `-w /work` so paths match CI.
docker run --rm $TTY_FLAG \
  --ipc=host \
  --init \
  -v "$(pwd):/work" \
  -v /work/node_modules \
  -v glassbox-pw-npm-cache:/tmp/.npm \
  -w /work \
  -e HOME=/tmp \
  -e CI=true \
  "${IMAGE}" \
  bash -lc "npm ci --no-audit --no-fund --prefer-offline && npm run build:client && npm run test:e2e -- $* --reporter=line"
