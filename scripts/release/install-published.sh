#!/usr/bin/env bash
# Install a just-published glassbox version from the npm registry, waiting out
# registry propagation lag, and prove the install actually landed.
#
# Usage: install-published.sh <version>
#
# Why this exists: the release smoke jobs install the version `npm publish`
# pushed moments earlier. The registry can take minutes to list a new version
# (v1.2.1-rc.1 became visible six minutes after `npm publish` returned), and
# the plain `npm install -g glassbox@<ver>` retry loop that gave up after ~75s
# produced two bad outcomes in one run: the fresh-install smoke failed on a
# version that did exist, and the upgrade smoke PASSED against the previously
# installed stable because its loop had no failure exit, so a propagation miss
# was indistinguishable from a real pass.
#
# So this script (1) polls the registry until the version is visible, bounded
# by GLASSBOX_NPM_WAIT_SECS (default 15 min); (2) installs with a few retries
# for tarball replication lag; and (3) asserts the globally installed package
# reports exactly the requested version — any mismatch is a hard failure.
#
# Env overrides (all optional, used by the unit test to make it fast):
#   GLASSBOX_NPM_WAIT_SECS         registry-visibility budget (default 900)
#   GLASSBOX_NPM_POLL_SECS         sleep between probes / install retries (default 20)
#   GLASSBOX_NPM_INSTALL_ATTEMPTS  install attempts once visible (default 5)
set -euo pipefail

VERSION="${1:?usage: install-published.sh <version>}"
WAIT_SECS="${GLASSBOX_NPM_WAIT_SECS:-900}"
POLL_SECS="${GLASSBOX_NPM_POLL_SECS:-20}"
INSTALL_ATTEMPTS="${GLASSBOX_NPM_INSTALL_ATTEMPTS:-5}"

# A throwaway cache, wiped before every probe: npm serves a cached packument
# for as long as the registry's max-age allows, so a probe that hit the cache
# could keep answering "not there" from a packument fetched before the publish.
probe_cache="$(mktemp -d)"
trap 'rm -rf "$probe_cache"' EXIT

deadline=$(( $(date +%s) + WAIT_SECS ))
echo "Waiting for glassbox@${VERSION} to appear on the npm registry (up to ${WAIT_SECS}s)..."
while :; do
  rm -rf "${probe_cache:?}"/*
  seen="$(npm view "glassbox@${VERSION}" version --cache "$probe_cache" 2>/dev/null || true)"
  if [ "$seen" = "$VERSION" ]; then
    echo "  visible"
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "FAILED — glassbox@${VERSION} not visible on the npm registry after ${WAIT_SECS}s" >&2
    exit 1
  fi
  echo "  not yet visible; retrying in ${POLL_SECS}s..."
  sleep "$POLL_SECS"
done

for i in $(seq 1 "$INSTALL_ATTEMPTS"); do
  if npm install -g --prefer-online "glassbox@${VERSION}"; then
    break
  fi
  if [ "$i" -eq "$INSTALL_ATTEMPTS" ]; then
    echo "FAILED — npm install -g glassbox@${VERSION} failed ${INSTALL_ATTEMPTS} times" >&2
    exit 1
  fi
  echo "  install attempt ${i} failed; retrying in ${POLL_SECS}s..."
  sleep "$POLL_SECS"
done

# Read the version straight from the installed package rather than trusting
# npm's exit code — this is the assertion that turns a silently-skipped upgrade
# into a red job.
global_root="$(npm root -g)"
installed="$(node -p "require(require('path').join(process.argv[1], 'glassbox', 'package.json')).version" "$global_root" 2>/dev/null || true)"
if [ "$installed" != "$VERSION" ]; then
  echo "FAILED — installed glassbox is '${installed:-<none>}', expected '${VERSION}'" >&2
  exit 1
fi
echo "Installed glassbox@${installed}"
