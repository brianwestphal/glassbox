#!/usr/bin/env bash
# Non-interactive beta release — cut + push a `v<version>-beta.<N>` tag with
# gitgist-drafted notes, no prompts and no $EDITOR. For automated / unattended
# (AFK) beta cuts; the interactive `scripts/release.sh --beta` remains the
# default for hands-on releases.
#
# It mirrors release.sh's beta path exactly: NO version-file bump and NO `main`
# push — just an annotated `v<version>-beta.<N>` tag pushed to origin. CI
# (`release-candidate.yml`, which fires on `v*-beta.*`) extracts the version
# from the tag, publishes npm with `--tag beta`, and creates a GitHub Release
# flagged `prerelease: true` (no `latest` flip, no auto-promote). The tag push
# carries the commit objects it references, so the bundle build sees the code
# even if `main` hasn't been pushed.
#
# Unlike release.sh it does NOT run `npm whoami`: the actual publish happens in
# CI via OIDC, so local npm auth isn't needed to cut the tag.
#
# Usage:
#   scripts/release-beta-auto.sh <X.Y.Z> [--notes <file>] [--dry-run]
#     <X.Y.Z>        target stable version this beta leads to (e.g. 0.15.0)
#     --notes <file> use this file's contents as the tag/release notes instead
#                    of generating them with gitgist
#     --dry-run      compute + print the tag name and notes, then stop (no tag,
#                    no push)
set -euo pipefail

VERSION=""
NOTES_FILE=""
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes) NOTES_FILE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) VERSION="$1"; shift ;;
  esac
done

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 <X.Y.Z> [--notes <file>] [--dry-run]" >&2
  exit 2
fi

# --- Safety checks ---
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean — commit or stash first." >&2
  exit 1
fi
branch=$(git branch --show-current)
if [[ "$branch" != "main" && "$branch" != "master" ]]; then
  echo "error: on branch '$branch', not main/master — betas are cut from main." >&2
  exit 1
fi

# Sync tags so the beta-number auto-increment and the notes base see the real
# upstream tag list (a stale local list would reuse a number or anchor wrong).
git fetch --tags --prune origin >/dev/null 2>&1 || echo "warning: tag fetch failed — proceeding with local tags."

# --- Auto-increment the beta number ---
n=1
while git rev-parse "v${VERSION}-beta.${n}" >/dev/null 2>&1; do
  n=$((n + 1))
done
TAG="v${VERSION}-beta.${n}"

# --- Notes ---
notes=""
if [[ -n "$NOTES_FILE" ]]; then
  [[ -f "$NOTES_FILE" ]] || { echo "error: notes file not found: $NOTES_FILE" >&2; exit 1; }
  notes=$(cat "$NOTES_FILE")
else
  # Beta notes anchor at the most recent tag (beta or stable), like release.sh.
  last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
  range="${last_tag:+${last_tag}..HEAD}"
  gitgist=""
  if [[ -x node_modules/.bin/gitgist ]]; then
    gitgist="node_modules/.bin/gitgist"
  elif command -v gitgist >/dev/null 2>&1; then
    gitgist="gitgist"
  fi
  if [[ -n "$gitgist" ]]; then
    notes=$("$gitgist" ${range:+"$range"} 2>/dev/null || true)
    [[ "$notes" == _No\ * ]] && notes=""
    # Fall back to the deterministic, no-AI grouping if the AI draft failed.
    if [[ -z "$notes" ]]; then
      notes=$("$gitgist" ${range:+"$range"} --no-ai 2>/dev/null || true)
      [[ "$notes" == _No\ * ]] && notes=""
    fi
  fi
fi
[[ -n "$notes" ]] || notes="Beta release ${TAG}."

echo "Tag:   ${TAG}"
echo "Commit: $(git rev-parse --short HEAD)"
echo "----- notes -----"
echo "$notes"
echo "-----------------"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "(dry run — no tag created, nothing pushed)"
  exit 0
fi

# --- Cut + push the annotated tag ---
echo "$notes" | git tag -a "$TAG" -F -
git push origin "$TAG"
echo "Pushed ${TAG} to origin. CI (release-candidate.yml) will build + publish the beta prerelease."
