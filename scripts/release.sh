#!/usr/bin/env bash
set -euo pipefail

# --- Config ---
STATE_FILE=".release-state.json"
PACKAGE_JSON="package.json"

# --- Colors ---
BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
RESET="\033[0m"

# --- Helpers ---
info()    { echo -e "${CYAN}${BOLD}>>>${RESET} $1"; }
success() { echo -e "${GREEN}${BOLD}>>>${RESET} $1"; }
warn()    { echo -e "${YELLOW}${BOLD}>>>${RESET} $1"; }
error()   { echo -e "${RED}${BOLD}>>>${RESET} $1"; }

confirm() {
  local prompt="$1"
  local response
  echo -en "${CYAN}${BOLD}>>>${RESET} ${prompt} ${DIM}[y/N]${RESET} "
  read -r response
  [[ "$response" =~ ^[Yy]$ ]]
}

# Ask a question, with optional previous value to keep/edit
ask() {
  local key="$1"
  local prompt="$2"
  local default="${3:-}"
  local prev
  prev=$(get_state "$key")

  if [[ -n "$prev" ]]; then
    echo -e "${CYAN}${BOLD}>>>${RESET} ${prompt}"
    echo -e "    ${DIM}Previous:${RESET} ${prev}"
    echo -en "    ${DIM}Press Enter to keep, or type new value:${RESET} "
    local input
    read -r input
    if [[ -z "$input" ]]; then
      REPLY="$prev"
    else
      REPLY="$input"
    fi
  elif [[ -n "$default" ]]; then
    echo -en "${CYAN}${BOLD}>>>${RESET} ${prompt} ${DIM}[${default}]${RESET} "
    local input
    read -r input
    REPLY="${input:-$default}"
  else
    echo -en "${CYAN}${BOLD}>>>${RESET} ${prompt} "
    read -r
  fi

  set_state "$key" "$REPLY"
}

# Resolve the user's preferred editor
resolve_editor() {
  if [[ -n "${EDITOR:-}" ]]; then echo "$EDITOR"; return; fi
  if [[ -n "${VISUAL:-}" ]]; then echo "$VISUAL"; return; fi
  for cmd in nano vim vi; do
    if command -v "$cmd" &>/dev/null; then echo "$cmd"; return; fi
  done
  echo ""
}

# Ask for multiline input via $EDITOR
ask_multiline() {
  local key="$1"
  local prompt="$2"
  local initial="${3:-}"
  local prev
  prev=$(get_state "$key")

  # Use previous value as starting content if available
  if [[ -n "$prev" ]]; then
    initial="$prev"
  fi

  local editor
  editor=$(resolve_editor)

  if [[ -z "$editor" ]]; then
    error "No editor found. Set \$EDITOR and try again."
    exit 1
  fi

  local tmpfile
  tmpfile=$(mktemp "${TMPDIR:-/tmp}/release-notes.XXXXXX")
  trap "rm -f '$tmpfile'" RETURN

  # Pre-populate the temp file
  if [[ -n "$initial" ]]; then
    echo -e "$initial" > "$tmpfile"
  fi

  while true; do
    info "${prompt} ${DIM}(opening ${editor##*/})${RESET}"
    $editor "$tmpfile"

    # Read back: strip lines starting with '#' (guidance/comments), then strip trailing blank lines
    REPLY=$(grep -v '^#' "$tmpfile" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')

    if [[ -z "$REPLY" ]]; then
      warn "Release notes are empty."
      if ! confirm "Open editor again?"; then
        error "Aborted — release notes are required."
        exit 1
      fi
      continue
    fi

    echo ""
    echo -e "    ${DIM}Release notes:${RESET}"
    echo "$REPLY" | sed 's/^/    /'
    echo ""

    if confirm "Use this text?"; then
      break
    fi
    # Otherwise loop back to the editor with the current content
    echo "$REPLY" > "$tmpfile"
  done

  set_state "$key" "$REPLY"
}

# --- State management ---
init_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo '{}' > "$STATE_FILE"
  fi
}

get_state() {
  node -e "
    const s = JSON.parse(require('fs').readFileSync('$STATE_FILE','utf8'));
    process.stdout.write(s[process.argv[1]] || '');
  " "$1" 2>/dev/null || echo ""
}

set_state() {
  node -e "
    const fs = require('fs');
    const s = JSON.parse(fs.readFileSync('$STATE_FILE','utf8'));
    s[process.argv[1]] = process.argv[2];
    fs.writeFileSync('$STATE_FILE', JSON.stringify(s, null, 2));
  " "$1" "$2"
}

get_step() {
  get_state "_step"
}

set_step() {
  set_state "_step" "$1"
}

past_step() {
  local current
  current=$(get_step)
  [[ -n "$current" ]] && [[ "$current" -gt "$1" ]]
}

cleanup_state() {
  rm -f "$STATE_FILE"
}

# --- Pre-flight checks ---
preflight() {
  info "Running pre-flight checks..."

  # Check we're in the right directory
  if [[ ! -f "$PACKAGE_JSON" ]]; then
    error "No package.json found. Run this from the project root."
    exit 1
  fi

  # Check git is clean
  if [[ -n "$(git status --porcelain)" ]]; then
    warn "Working directory is not clean:"
    git status --short
    echo ""
    if ! confirm "Continue anyway?"; then
      exit 1
    fi
  fi

  # Check npm auth
  if ! npm whoami &>/dev/null; then
    error "Not logged in to npm. Run 'npm login' first."
    exit 1
  fi

  local npm_user
  npm_user=$(npm whoami)
  success "Logged in to npm as ${BOLD}${npm_user}${RESET}"

  # Check on main/master branch
  local branch
  branch=$(git branch --show-current)
  if [[ "$branch" != "main" && "$branch" != "master" ]]; then
    warn "You're on branch '${branch}', not main/master."
    if ! confirm "Continue anyway?"; then
      exit 1
    fi
  fi
}

# --- Steps ---
step_version() {
  local current_version
  current_version=$(node -p "require('./package.json').version")
  info "Current version: ${BOLD}${current_version}${RESET}"

  # Calculate suggested versions
  local major minor patch
  IFS='.' read -r major minor patch <<< "$current_version"
  local next_patch="${major}.${minor}.$((patch + 1))"
  local next_minor="${major}.$((minor + 1)).0"
  local next_major="$((major + 1)).0.0"

  echo ""
  echo -e "    ${DIM}Enter)${RESET} keep   ${BOLD}${current_version}${RESET} ${DIM}(no change)${RESET}"
  echo -e "    ${DIM}1)${RESET}     patch  ${BOLD}${next_patch}${RESET}"
  echo -e "    ${DIM}2)${RESET}     minor  ${BOLD}${next_minor}${RESET}"
  echo -e "    ${DIM}3)${RESET}     major  ${BOLD}${next_major}${RESET}"
  echo -e "    ${DIM}4)${RESET}     custom"
  echo ""

  local prev_version
  prev_version=$(get_state "version")
  if [[ -n "$prev_version" && "$prev_version" != "$current_version" ]]; then
    echo -e "    ${DIM}Previous selection:${RESET} ${prev_version}"
    if confirm "Keep ${prev_version}?"; then
      REPLY="$prev_version"
      set_state "version" "$REPLY"
      return
    fi
  fi

  echo -en "${CYAN}${BOLD}>>>${RESET} Choose version bump ${DIM}[Enter/1/2/3/4]${RESET} "
  local choice
  read -r choice
  case "$choice" in
    "") REPLY="$current_version" ;;
    1) REPLY="$next_patch" ;;
    2) REPLY="$next_minor" ;;
    3) REPLY="$next_major" ;;
    4)
      echo -en "${CYAN}${BOLD}>>>${RESET} Enter version: "
      read -r REPLY
      ;;
    *)
      error "Invalid choice"
      exit 1
      ;;
  esac

  set_state "version" "$REPLY"
}

step_release_notes() {
  echo ""

  # If we have saved notes from a prior run of this same release, ask_multiline
  # will pick them up via get_state — skip the AI draft entirely so we don't
  # waste a model call on resume.
  local prev
  prev=$(get_state "release_notes")
  if [[ -n "$prev" ]]; then
    ask_multiline "release_notes" "Release notes" ""
    return
  fi

  # Stable releases anchor at the last PRODUCTION tag (`vX.Y.Z` with no
  # `-beta.N` / `-rc.N` suffix) so the release notes summarize every change
  # since the previous stable, not just since the most recent beta. Beta
  # releases anchor at whatever the previous tag was (beta or stable) —
  # they're incremental and shouldn't repeat bullets that already appeared
  # in an earlier beta's notes.
  local last_tag
  if [[ "${BETA_MODE:-false}" == "true" ]]; then
    last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
  else
    last_tag=$(git describe --tags --abbrev=0 --exclude='*-beta.*' --exclude='*-rc.*' 2>/dev/null || echo "")
  fi
  local log_range="${last_tag:+${last_tag}..HEAD}"
  local commit_log
  commit_log=$(git log ${log_range:-"-30"} --format="%s" --no-decorate)
  local commit_count
  commit_count=$(echo "$commit_log" | grep -c '^' || echo "0")

  # Branch the prompt body on BETA_MODE. A beta cycle diffs against the
  # immediately-previous tag (5–20 commits typically) and wants a tight
  # 5–10-bullet summary so each beta's notes don't repeat the prior one's.
  # A stable cut diffs against the last PRODUCTION tag, which over a v0.X
  # → v0.X+1 cycle can be 100+ commits totalling many KB of subject text;
  # the tight beta budget instructs the model to drop ~95% of the content,
  # so the stable prompt asks for a wider, section-grouped summary plus
  # tells the model how many commits it's summarizing so it self-paces.
  local generated=""
  if command -v claude &>/dev/null; then
    info "Drafting release notes with Claude (${commit_count} commits since ${last_tag:-last 30})..."
    local prompt
    local beta_rules
    beta_rules="Rules:
- Output ONLY markdown bullets — no heading, no preamble, no closing remarks.
- Each bullet is ONE short line (~80 chars max), user-facing.
- Group related changes into single bullets.
- INCLUDE: new features, UX improvements, bug fixes, breaking changes — anything a user upgrading would notice.
- EXCLUDE: ticket IDs (GB-NNNN), internal refactors, test additions, doc-only changes, implementation rationale, build/CI tweaks.
- Aim for 5–10 bullets total. Fewer is better."
    local stable_rules
    stable_rules="This is a STABLE release summarizing ${commit_count} commits since the last production release ${last_tag:-HEAD~30}. Be thorough — these notes will land in CHANGELOG.md.

Rules:
- Group bullets under H2 markdown headings: \"## New features\", \"## UX improvements\", \"## Bug fixes\", \"## Performance\", \"## Developer-facing\". Omit any heading whose section is empty.
- Each bullet is ONE short line (~80 chars max), user-facing.
- Group several related commits into single bullets when they cover the same feature area.
- INCLUDE: new features, UX improvements, bug fixes, breaking changes, performance improvements, notable refactors that change user-observable behavior.
- EXCLUDE: ticket IDs (GB-NNNN), pure internal refactors, test-only additions, doc-only changes, implementation rationale, build/CI tweaks.
- For a ${commit_count}-commit release cycle aim for 15–40 total bullets, scaled to the volume of user-visible work. Don't pad — if a section has nothing user-facing, drop it. Don't under-deliver either — a stable release of this size shouldn't summarize down to 5 bullets."
    local body
    if [[ "${BETA_MODE:-false}" == "true" ]]; then
      body="$beta_rules"
    else
      body="$stable_rules"
    fi
    prompt="Draft release notes for Glassbox (a local code review tool for AI-generated code) from the commit subjects below.

${body}

Commits:
${commit_log}"
    # Pipe the prompt via stdin instead of \"claude -p \$prompt\" so we don't
    # blow past ARG_MAX (1 MB on macOS — a stable cycle's commit-subject
    # volume can put the positional-arg form right at the kernel's E2BIG
    # cliff with silent truncation).
    generated=$(printf '%s' "$prompt" | claude -p 2>/dev/null || true)
    # Strip leading/trailing blank lines + any stray code-fence wrappers
    generated=$(echo "$generated" | sed -e '/^```/d' -e :a -e '/^[[:space:]]*$/{$d;N;ba' -e '}')
    # `claude -p` can return 200 OK with an auth/network error printed to
    # stdout (e.g. "Failed to authenticate. API Error: 403 ..."). Without
    # this guard, that text would pass the empty-stdout check below and
    # become the CHANGELOG entry / annotated tag body. Treat known error
    # signatures as empty so the placeholder fallback fires instead.
    if echo "$generated" | head -1 | grep -qE '^(Failed to authenticate|API Error:|Error:)'; then
      warn "Claude draft looks like an auth/network error — opening blank editor."
      warn "  First line: $(echo "$generated" | head -1)"
      generated=""
    fi
  fi

  local initial
  if [[ -n "$generated" ]]; then
    success "Draft ready — review and edit in the editor."
    initial="# Release notes — Claude draft below. Edit freely.
# Lines starting with '#' are removed on save.

${generated}"
  else
    if command -v claude &>/dev/null; then
      warn "Claude draft was empty — opening blank editor."
    else
      warn "'claude' CLI not found — opening blank editor. Install Claude Code for AI drafts."
    fi
    initial="# Release notes — keep it SHORT and USER-FACING.
# Bullets only. Skip ticket IDs, refactors, tests, docs, internals.
# Lines starting with '#' are removed on save.

- "
  fi

  ask_multiline "release_notes" "Release notes" "$initial"
}

step_review() {
  local version
  version=$(get_state "version")
  local notes
  notes=$(get_state "release_notes")

  echo ""
  echo -e "${BOLD}━━━ Release Summary ━━━${RESET}"
  echo ""
  echo -e "  ${DIM}Version:${RESET}  ${BOLD}${version}${RESET}"
  echo -e "  ${DIM}Notes:${RESET}"
  echo -e "$notes" | sed 's/^/    /'
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo ""
}

step_build() {
  info "Building..."
  npm run build
  echo ""

  info "Package contents:"
  npm pack --dry-run 2>&1 | grep "npm notice" | grep -v "^npm notice$"
  echo ""
}

step_update_version() {
  local version
  version=$(get_state "version")
  info "Updating version to ${BOLD}v${version}${RESET} in all files..."

  # Update package.json (no git tag yet)
  npm version "$version" --no-git-tag-version --allow-same-version

  # Update src-tauri/tauri.conf.json
  if [[ -f "src-tauri/tauri.conf.json" ]]; then
    node -e "
      const fs = require('fs');
      const f = 'src-tauri/tauri.conf.json';
      const c = JSON.parse(fs.readFileSync(f, 'utf8'));
      c.version = process.argv[1];
      fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n');
    " "$version"
    success "src-tauri/tauri.conf.json updated"
  fi

  # Update src-tauri/Cargo.toml
  if [[ -f "src-tauri/Cargo.toml" ]]; then
    sed -i '' "s/^version = \".*\"/version = \"${version}\"/" src-tauri/Cargo.toml
    success "src-tauri/Cargo.toml updated"
  fi

  success "All version files updated to ${version}"
}

step_update_changelog() {
  local version
  version=$(get_state "version")
  local notes
  notes=$(get_state "release_notes")
  local date
  date=$(date +%Y-%m-%d)

  info "Updating CHANGELOG.md..."

  # Format the release notes as a changelog entry. The AI draft / editor
  # template already produces well-formed markdown (H2-grouped bullets
  # for stable, flat bullets for beta), so no further normalization here.
  local entry
  entry="## [${version}] - ${date}\n\n${notes}"

  # Insert before the first existing entry, or append after the header.
  node -e "
    const fs = require('fs');
    const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
    const marker = changelog.indexOf('\n## [');
    if (marker === -1) {
      // No existing entries — append after the header
      const headerEnd = changelog.lastIndexOf('\n\n') + 2;
      const updated = changelog.slice(0, headerEnd) + process.argv[1] + '\n\n';
      fs.writeFileSync('CHANGELOG.md', updated);
    } else {
      // Insert before the first existing entry
      const updated = changelog.slice(0, marker) + '\n' + process.argv[1] + '\n' + changelog.slice(marker);
      fs.writeFileSync('CHANGELOG.md', updated);
    }
  " "$(echo -e "$entry")"

  success "CHANGELOG.md updated"
}

step_git_commit() {
  local version
  version=$(get_state "version")

  info "Creating git commit..."

  git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml CHANGELOG.md 2>/dev/null || git add package.json CHANGELOG.md
  git commit -m "release: v${version}" --allow-empty

  success "Created release commit"
}

step_rc_tag_and_push() {
  local version
  version=$(get_state "version")
  local notes
  notes=$(get_state "release_notes")

  # Auto-increment RC number: find existing v{version}-rc.N tags
  local rc_num=1
  while git rev-parse "v${version}-rc.${rc_num}" >/dev/null 2>&1; do
    rc_num=$((rc_num + 1))
  done
  local rc_tag="v${version}-rc.${rc_num}"

  info "Creating RC tag ${BOLD}${rc_tag}${RESET}..."

  # Create annotated tag with release notes
  echo -e "$notes" | git tag -a "$rc_tag" -F -

  info "Pushing commit and RC tag to origin..."
  git push
  git push origin "$rc_tag"

  echo ""
  success "RC tag ${rc_tag} pushed!"
  echo ""
  echo -e "  ${DIM}CI will now:${RESET}"
  echo -e "    1. Run tests, lint, and build verification"
  echo -e "    2. Publish beta to npm (glassbox@${version}-rc.${rc_num})"
  echo -e "    3. Run smoke tests (fresh install + upgrade)"
  echo -e "    4. Auto-promote to glassbox@${version} on npm"
  echo -e "    5. Create final v${version} tag → desktop release"
  echo ""
  echo -e "  ${DIM}Monitor progress:${RESET} https://github.com/brianwestphal/glassbox/actions"
}

# Beta tag-and-push: like the RC path but creates v{ver}-beta.{N} tags off
# HEAD without first committing version-file bumps. The CI workflow
# (release-beta.yml) extracts the version from the tag, publishes npm with
# `--tag beta`, and creates a GitHub Release flagged `prerelease: true` so
# `releases/latest` (Tauri updater + npm `latest` upgrade-nudge) keeps
# pointing at the prior stable. There is no auto-promote — betas stay opt-in
# via `npm install glassbox@beta` or by downloading the GH Release page.
step_beta_tag_and_push() {
  local version
  version=$(get_state "version")
  local notes
  notes=$(get_state "release_notes")

  # Auto-increment beta number: find existing v{version}-beta.N tags
  local beta_num=1
  while git rev-parse "v${version}-beta.${beta_num}" >/dev/null 2>&1; do
    beta_num=$((beta_num + 1))
  done
  local beta_tag="v${version}-beta.${beta_num}"

  info "Creating beta tag ${BOLD}${beta_tag}${RESET}..."

  # Annotated tag with release notes
  echo -e "$notes" | git tag -a "$beta_tag" -F -

  info "Pushing beta tag to origin..."
  git push origin "$beta_tag"

  echo ""
  success "Beta tag ${beta_tag} pushed!"
  echo ""
  echo -e "  ${DIM}CI will now:${RESET}"
  echo -e "    1. Run tests, lint, and build verification"
  echo -e "    2. Publish beta to npm (glassbox@${version}-beta.${beta_num}) with --tag beta"
  echo -e "    3. Build Tauri bundles for every platform"
  echo -e "    4. Create a GitHub Release flagged ${BOLD}prerelease: true${RESET}"
  echo ""
  echo -e "  ${DIM}This is a beta — there is no auto-promote.${RESET}"
  echo -e "  ${DIM}Users get it via:${RESET}  npm install glassbox@beta"
  echo -e "  ${DIM}Or by downloading from the GitHub Release page.${RESET}"
  echo -e "  ${DIM}The Tauri updater + npm upgrade-nudge keep pointing at the prior${RESET}"
  echo -e "  ${DIM}stable because GitHub's releases/latest and npm's latest dist-tag${RESET}"
  echo -e "  ${DIM}both skip prereleases automatically.${RESET}"
  echo ""
  echo -e "  ${DIM}Monitor progress:${RESET} https://github.com/brianwestphal/glassbox/actions"
}

# --- Main ---
main() {
  # --beta switches the flow into pre-release mode: no version-file bumps,
  # no CHANGELOG entry, no release commit; just a v{ver}-beta.{N} tag pushed
  # off HEAD. CI publishes npm with --tag beta and creates a GH Release
  # flagged prerelease: true so the Tauri updater + npm upgrade-nudge skip it.
  BETA_MODE=false
  for arg in "$@"; do
    case "$arg" in
      --beta) BETA_MODE=true ;;
    esac
  done

  echo ""
  if [[ "$BETA_MODE" == "true" ]]; then
    echo -e "${BOLD}  Glassbox Beta Release${RESET}"
    echo -e "  ${DIM}--beta mode: tag-only, no version-file bump, no auto-promote.${RESET}"
  else
    echo -e "${BOLD}  Glassbox Release${RESET}"
  fi
  echo ""

  init_state

  local resume_step
  resume_step=$(get_step)
  if [[ -n "$resume_step" && "$resume_step" -gt 0 ]]; then
    warn "Found saved progress (step ${resume_step}/8)."
    if confirm "Resume from where you left off?"; then
      echo ""
    else
      if confirm "Start over from scratch?"; then
        cleanup_state
        init_state
        resume_step=""
      else
        exit 0
      fi
    fi
  fi

  # Step 1: Pre-flight
  if ! past_step 1; then
    preflight
    set_step 1
  fi

  # Step 2: Release notes (before version, so you see what changed)
  if ! past_step 2; then
    step_release_notes
    set_step 2
  fi

  # Step 3: Version
  if ! past_step 3; then
    echo ""
    step_version
    set_step 3
  fi

  # Step 4: Review
  if ! past_step 4; then
    step_review
    if [[ "$BETA_MODE" == "true" ]]; then
      if ! confirm "Proceed with this BETA release?"; then
        warn "Aborted. State saved — run again to resume or edit."
        exit 0
      fi
    else
      if ! confirm "Proceed with this release?"; then
        warn "Aborted. State saved — run again to resume or edit."
        exit 0
      fi
    fi
    set_step 4
  fi

  if [[ "$BETA_MODE" == "true" ]]; then
    # Beta path: skip version/changelog/commit steps. The user-entered version
    # is the upcoming target (e.g. 0.9.0); package.json stays at the current
    # stable until the actual final release runs. CI bumps the version
    # ephemerally at publish time via `npm version ... --no-git-tag-version`.

    # Step 7: Build + local checks (still run them — beta should pass too)
    if ! past_step 7; then
      echo ""
      step_build

      info "Running local checks..."
      echo ""
      info "Unit tests..."
      npm test
      echo ""
      info "Linting..."
      npm run lint
      echo ""
      info "Type checking..."
      npx tsc --noEmit
      success "All local checks passed"
      set_step 7
    fi

    # Step 8: Beta tag + push (no commit)
    if ! past_step 8; then
      step_beta_tag_and_push
      set_step 8
    fi

    echo ""
    success "Beta submitted! CI will publish npm@beta and prerelease bundles."
    cleanup_state
    return
  fi

  # Stable path: full version-bump + changelog + commit + RC tag flow.

  # Step 5: Update version in package.json
  if ! past_step 5; then
    echo ""
    step_update_version
    set_step 5
  fi

  # Step 6: Update CHANGELOG.md
  if ! past_step 6; then
    step_update_changelog
    set_step 6
  fi

  # Step 7: Build + local checks
  if ! past_step 7; then
    echo ""
    step_build

    info "Running local checks..."
    echo ""
    info "Unit tests..."
    npm test
    echo ""
    info "Linting..."
    npm run lint
    echo ""
    info "Type checking..."
    npx tsc --noEmit
    success "All local checks passed"
    set_step 7
  fi

  # Step 8: Git commit + RC tag + push
  if ! past_step 8; then
    step_git_commit
    step_rc_tag_and_push
    set_step 8
  fi

  # Done — clean up
  echo ""
  success "Release candidate submitted! CI will handle testing and publishing."
  cleanup_state
}

main "$@"
