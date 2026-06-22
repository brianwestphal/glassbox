#!/usr/bin/env bash
#
# Non-interactive beta release. Same outcome as `npm run release:beta`
# (`scripts/release.sh --beta`) but answers every prompt automatically so it
# can run from automation (CI, a cron, or Claude when the user says "push a
# beta").
#
# Why a separate script rather than piping answers into release.sh?
# The interactive script is a resumable state machine with several
# `read`-driven branches (version-bump menu, the release-notes editor loop and
# its "use this text?" confirm, the "proceed with this BETA release?" confirm,
# and the resume-from-saved-state prompt). Feeding those with echo-pipes is
# brittle because the answers depend on the saved `.release-state.json`. It is
# cleaner to re-implement just the beta path here than to bend the interactive
# script into something it is not.
#
# What this does — matches `release.sh --beta` exactly:
#   1. Preflight: working tree clean; on main/master; node present; fetch tags.
#      (Skips the `npm whoami` check release.sh does — beta publishes run in
#      GitHub Actions via NPM_TOKEN, not local credentials, so the
#      tag-and-push path needs no local npm login.)
#   2. Pick the target version. Explicit `--version X.Y.Z` (or a bare positional
#      `X.Y.Z`) wins. Otherwise: if package.json's version isn't yet a stable
#      `vX.Y.Z` tag it IS the upcoming release, so target it; else next minor.
#   3. Draft release notes with gitgist (the tool release.sh uses) over
#      `<lastTag>..HEAD`: AI draft, then gitgist `--no-ai` deterministic
#      grouping, then a `git log` pointer. Override with `--notes <file>` /
#      `--notes-stdin`.
#   4. Build + unit tests (auto-retry once) + lint + typecheck.
#   5. Auto-increment the beta number (highest existing `v<ver>-beta.N` + 1),
#      create an annotated tag with the notes as the message, and push the tag
#      (NOT a commit — beta mode skips version-file bumps + the release commit;
#      CI bumps the version ephemerally at publish time).
#
# What CI does on tag push — `.github/workflows/release-candidate.yml` (unified
# workflow, triggers on both `v*-rc.*` and `v*-beta.*`):
#   1. Re-runs validation (tests + lint + build).
#   2. Publishes glassbox@<ver>-beta.N to npm with `--tag beta` (no @latest).
#   3. Builds Tauri bundles for every platform.
#   4. Creates a GitHub Release flagged prerelease: true, so the Tauri updater
#      and the npm upgrade-nudge skip it (both resolve releases/latest, which
#      GitHub auto-filters past prereleases).
#
# Install the beta:  npm install glassbox@beta  (or download the GH Release)
# Unwind a botched beta tag before CI finishes:
#   git tag -d v<ver>-beta.N && git push origin :refs/tags/v<ver>-beta.N
#
# Exit codes:
#   0 — beta tag pushed (or --dry-run completed); CI is running.
#   1 — preflight / argument failure (dirty tree, wrong branch, missing tools).
#   2 — local checks failed (test / lint / tsc).
#   3 — git tag or push failed (tag already exists, or upstream rejected).
#
set -euo pipefail

# --- Colors (stripped on a non-tty so captured logs stay clean) ---
if [[ -t 1 ]]; then
  BOLD="\033[1m"; DIM="\033[2m"; GREEN="\033[32m"; YELLOW="\033[33m"
  RED="\033[31m"; CYAN="\033[36m"; RESET="\033[0m"
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; RESET=""
fi
info()    { echo -e "${CYAN}${BOLD}>>>${RESET} $1"; }
success() { echo -e "${GREEN}${BOLD}>>>${RESET} $1"; }
warn()    { echo -e "${YELLOW}${BOLD}>>>${RESET} $1"; }
error()   { echo -e "${RED}${BOLD}>>>${RESET} $1" >&2; }

# --- Argv ---
OVERRIDE_VERSION=""
SKIP_TESTS="false"
DRY_RUN="false"
NOTES_OVERRIDE=""
NOTES_SOURCE_LABEL=""
set_version() {
  if [[ -n "$OVERRIDE_VERSION" ]]; then
    error "Version given more than once ('$OVERRIDE_VERSION' and '$1')."
    exit 1
  fi
  OVERRIDE_VERSION="$1"
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ -z "${2:-}" ]] && { error "--version requires a value (e.g. --version 0.17.0)"; exit 1; }
      set_version "$2"; shift 2 ;;
    --version=*) set_version "${1#--version=}"; shift ;;
    --skip-tests) SKIP_TESTS="true"; shift ;;
    --dry-run) DRY_RUN="true"; shift ;;
    --notes)
      [[ -z "${2:-}" ]] && { error "--notes requires a file path (or use --notes-stdin)"; exit 1; }
      [[ ! -f "$2" ]] && { error "--notes file not found: $2"; exit 1; }
      NOTES_OVERRIDE=$(cat "$2"); NOTES_SOURCE_LABEL="--notes $2"; shift 2 ;;
    --notes=*)
      notes_path="${1#--notes=}"
      [[ ! -f "$notes_path" ]] && { error "--notes file not found: $notes_path"; exit 1; }
      NOTES_OVERRIDE=$(cat "$notes_path"); NOTES_SOURCE_LABEL="--notes=$notes_path"; shift ;;
    --notes-stdin) NOTES_OVERRIDE=$(cat); NOTES_SOURCE_LABEL="--notes-stdin"; shift ;;
    -h|--help)
      cat <<EOF
Usage: bash scripts/release-beta-auto.sh [X.Y.Z | --version X.Y.Z] [--skip-tests] [--dry-run] [--notes <file> | --notes-stdin]

Non-interactive beta release for Glassbox — same result as \`npm run release:beta\`
without prompts. Version: pass X.Y.Z (bare or via --version) to target it
explicitly; otherwise it targets package.json's version when that hasn't shipped
as a stable tag yet, else the next minor.

Release notes are drafted by gitgist (the tool the interactive release uses)
over <lastTag>..HEAD — AI draft, then gitgist --no-ai, then a git-log pointer.
Pass --notes <file> or --notes-stdin to supply your own.
--skip-tests bypasses the local unit-test step (CI re-runs everything anyway).
--dry-run does everything EXCEPT create and push the tag (preflight, version,
notes, build, tests) so you can verify a release before committing to it.

Examples:
  npm run release:beta:auto
  npm run release:beta:auto -- --version 0.17.0
  npm run release:beta:auto -- 0.17.0 --dry-run
  npm run release:beta:auto -- --notes /tmp/notes.md
  echo "- fix X" | npm run release:beta:auto -- --notes-stdin
EOF
      exit 0 ;;
    -*)
      error "Unrecognized arg: $1"
      error "Usage: bash scripts/release-beta-auto.sh [X.Y.Z | --version X.Y.Z] [--skip-tests] [--dry-run] [--notes <file> | --notes-stdin]"
      exit 1 ;;
    *)
      # Bare positional version (back-compat with the original interface).
      set_version "$1"; shift ;;
  esac
done

if [[ -n "$OVERRIDE_VERSION" && ! "$OVERRIDE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  error "Version must look like X.Y.Z (got '$OVERRIDE_VERSION')."
  exit 1
fi

# --- Preflight ---
preflight() {
  info "Preflight..."

  [[ -f "package.json" ]] || { error "No package.json — run from the project root."; exit 1; }
  command -v node >/dev/null || { error "node not found on PATH."; exit 1; }

  if [[ -n "$(git status --porcelain)" ]]; then
    error "Working tree is dirty. Commit or stash before running a beta."
    git status --short >&2
    exit 1
  fi

  local branch
  branch=$(git branch --show-current)
  if [[ "$branch" != "main" && "$branch" != "master" ]]; then
    error "Current branch is '${branch}', not main/master. Refusing to cut a beta from a side branch."
    exit 1
  fi

  # Fetch tags so the version default and the beta-number auto-increment see
  # every existing tag — a stale local list would anchor the notes at an
  # out-of-date base or reuse a beta number the remote already holds (push
  # rejected). Not pruning tags: deleting local-only tags not yet pushed is too
  # aggressive. Non-fatal — offline runs proceed and the push surfaces a clash.
  info "Fetching tags from origin..."
  git fetch --tags origin 2>/dev/null || warn "git fetch --tags failed (offline?) — using the local tag list."

  success "Preflight clean (branch=${branch}, tree clean)"
}

# --- Target version ---
read_version() {
  if [[ -n "$OVERRIDE_VERSION" ]]; then
    VERSION="$OVERRIDE_VERSION"
    info "Target version (explicit): ${BOLD}${VERSION}${RESET}"
    return
  fi

  local current
  current=$(node -p "require('./package.json').version")

  if git rev-parse "v${current}" >/dev/null 2>&1; then
    # package.json's version already shipped as a stable tag — target next minor.
    local major minor patch
    IFS='.' read -r major minor patch <<< "$current"
    VERSION="${major}.$((minor + 1)).0"
    info "package.json (${current}) is already a stable tag — targeting next minor: ${BOLD}${VERSION}${RESET}"
  else
    # package.json's version hasn't shipped stable — it IS the upcoming release.
    VERSION="$current"
    info "package.json (${VERSION}) is not yet a stable tag — targeting it directly"
  fi
}

# --- Release notes (gitgist, matching release.sh) ---
resolve_gitgist() {
  if [[ -x "node_modules/.bin/gitgist" ]]; then
    echo "node_modules/.bin/gitgist"
  elif command -v gitgist >/dev/null; then
    echo "gitgist"
  fi
}

draft_release_notes() {
  if [[ -n "$NOTES_OVERRIDE" ]]; then
    NOTES="$NOTES_OVERRIDE"
    info "Using release notes from ${BOLD}${NOTES_SOURCE_LABEL}${RESET}:"
    echo "$NOTES" | sed 's/^/    /'
    return
  fi

  # Beta notes anchor at the most recent tag (beta or stable) — they're
  # incremental and shouldn't repeat bullets from an earlier beta. Same anchor
  # as release.sh's beta path.
  local last_tag range
  last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
  range="${last_tag:+${last_tag}..HEAD}"
  local pointer="- See \`git log ${range:-HEAD}\` for details."

  local gitgist
  gitgist=$(resolve_gitgist)
  if [[ -z "$gitgist" ]]; then
    warn "'gitgist' not found (run 'npm install' — it's a devDependency). Using a git-log pointer."
    NOTES="$pointer"
    return
  fi

  info "Drafting release notes with gitgist (${range:-since last tag})..."
  local errfile generated
  errfile=$(mktemp "${TMPDIR:-/tmp}/gitgist-beta-auto.XXXXXX")
  generated=$("$gitgist" ${range:+"$range"} 2>"$errfile" || true)
  [[ "$generated" == _No\ * ]] && generated=""

  # Fall back to gitgist's deterministic (no-AI) grouping if the AI draft failed
  # or no provider was available — better than a bare log pointer.
  if [[ -z "$generated" ]]; then
    warn "gitgist AI draft empty/failed — trying deterministic (--no-ai) grouping."
    [[ -s "$errfile" ]] && warn "  $(tail -1 "$errfile" 2>/dev/null)"
    generated=$("$gitgist" ${range:+"$range"} --no-ai 2>/dev/null || true)
    [[ "$generated" == _No\ * ]] && generated=""
  fi
  rm -f "$errfile"

  NOTES="${generated:-$pointer}"

  echo ""
  echo -e "    ${DIM}Drafted notes:${RESET}"
  echo "$NOTES" | sed 's/^/    /'
  echo ""
}

# --- Local checks ---
run_local_checks() {
  info "Build + tests + lint + typecheck..."

  npm run build
  echo ""

  if [[ "$SKIP_TESTS" == "true" ]]; then
    warn "Skipping unit tests (--skip-tests). Use only when you've verified the suite passes elsewhere."
  else
    info "Unit tests..."
    # Retry once: the suite has a few timing-sensitive files under parallel
    # load; a second pass with a warm cache almost always settles a real flake,
    # and a second failure is far more likely a genuine regression.
    if ! npm test; then
      warn "Unit tests failed on first pass — retrying once in case of load-induced flake..."
      npm test || { error "Unit tests failed after retry. Re-run with --skip-tests only if you've validated the failure is environmental."; exit 2; }
    fi
    echo ""
  fi

  info "Lint..."
  npm run lint || { error "Lint failed."; exit 2; }
  echo ""

  info "Type check..."
  npx tsc --noEmit || { error "tsc failed."; exit 2; }
  echo ""

  success "All local checks passed"
}

# --- Tag + push ---
tag_and_push() {
  local n=1
  while git rev-parse "v${VERSION}-beta.${n}" >/dev/null 2>&1; do
    n=$((n + 1))
  done
  BETA_TAG="v${VERSION}-beta.${n}"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    success "Dry run complete — would create + push ${BOLD}${BETA_TAG}${RESET} (commit $(git rev-parse --short HEAD)) with the drafted notes."
    info "Re-run without --dry-run to cut the beta."
    return
  fi

  info "Creating tag ${BOLD}${BETA_TAG}${RESET} with the drafted release notes..."
  echo -e "$NOTES" | git tag -a "$BETA_TAG" -F - || { error "git tag -a failed."; exit 3; }

  info "Pushing tag to origin..."
  git push origin "$BETA_TAG" || {
    error "git push failed. Tag exists locally but not on origin."
    error "Retry after fixing:  git push origin ${BETA_TAG}"
    error "Unwind:              git tag -d ${BETA_TAG}"
    exit 3
  }

  echo ""
  success "Beta tag ${BOLD}${BETA_TAG}${RESET} pushed."
  echo ""
  echo -e "  ${DIM}CI is now:${RESET}"
  echo -e "    1. Re-running validation (tests, lint, build)."
  echo -e "    2. Publishing glassbox@${VERSION}-beta.${n} to npm with --tag beta."
  echo -e "    3. Building Tauri bundles for every platform."
  echo -e "    4. Creating a GitHub Release flagged ${BOLD}prerelease: true${RESET}."
  echo ""
  echo -e "  ${DIM}Install via:${RESET}  npm install glassbox@beta"
  echo -e "  ${DIM}Monitor:${RESET}     https://github.com/brianwestphal/glassbox/actions"
}

# --- Main ---
echo ""
echo -e "${BOLD}  Glassbox Beta — auto/non-interactive${RESET}"
[[ "$DRY_RUN" == "true" ]] && echo -e "  ${DIM}--dry-run: no tag will be created or pushed.${RESET}"
echo ""

preflight
read_version
draft_release_notes
run_local_checks
tag_and_push
