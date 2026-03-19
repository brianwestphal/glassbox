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

    # Read back, strip trailing blank lines
    REPLY=$(sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$tmpfile")

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
  echo -e "    ${DIM}1)${RESET} patch  ${BOLD}${next_patch}${RESET}"
  echo -e "    ${DIM}2)${RESET} minor  ${BOLD}${next_minor}${RESET}"
  echo -e "    ${DIM}3)${RESET} major  ${BOLD}${next_major}${RESET}"
  echo -e "    ${DIM}4)${RESET} custom"
  echo ""

  local prev_version
  prev_version=$(get_state "version")
  if [[ -n "$prev_version" ]]; then
    echo -e "    ${DIM}Previous selection:${RESET} ${prev_version}"
    if confirm "Keep ${prev_version}?"; then
      REPLY="$prev_version"
      set_state "version" "$REPLY"
      return
    fi
  fi

  echo -en "${CYAN}${BOLD}>>>${RESET} Choose version bump ${DIM}[1/2/3/4]${RESET} "
  local choice
  read -r choice
  case "$choice" in
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

  # Build initial content from commits since last tag
  local last_tag
  last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
  local log_range="${last_tag:+${last_tag}..HEAD}"
  local initial
  initial=$(git log ${log_range:-"-10"} --format="- %s" --no-decorate)

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

step_changelog() {
  local version
  version=$(get_state "version")
  local notes
  notes=$(get_state "release_notes")
  local date
  date=$(date +%Y-%m-%d)

  info "Updating CHANGELOG.md..."

  # Build the new entry
  local entry
  entry="## [${version}] - ${date}"$'\n\n'
  # Convert notes to markdown list items (if not already)
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if [[ "$line" == -* ]]; then
      entry+="${line}"$'\n'
    else
      entry+="- ${line}"$'\n'
    fi
  done <<< "$(echo -e "$notes")"

  if [[ -f "CHANGELOG.md" ]]; then
    # Insert after the header line (line starting with "# Changelog" + blank + description + blank)
    node -e "
      const fs = require('fs');
      const content = fs.readFileSync('CHANGELOG.md', 'utf8');
      const entry = process.argv[1];
      // Find the first ## heading and insert before it
      const idx = content.indexOf('\n## ');
      if (idx !== -1) {
        const updated = content.slice(0, idx) + '\n' + entry + '\n' + content.slice(idx + 1);
        fs.writeFileSync('CHANGELOG.md', updated);
      } else {
        // No existing entries, append
        fs.writeFileSync('CHANGELOG.md', content + '\n' + entry);
      }
    " "$entry"
  else
    echo -e "# Changelog\n\nAll notable changes to Glassbox are documented here.\n\n${entry}" > CHANGELOG.md
  fi

  success "CHANGELOG.md updated"
}

step_git_tag() {
  local version
  version=$(get_state "version")
  local notes
  notes=$(get_state "release_notes")
  local tag="v${version}"

  info "Creating git commit and tag ${BOLD}${tag}${RESET}..."

  git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml CHANGELOG.md 2>/dev/null || git add package.json CHANGELOG.md
  git commit -m "release: v${version}" --allow-empty

  # Create annotated tag with release notes
  echo -e "$notes" | git tag -a "$tag" -F -

  success "Created tag ${tag}"
}

step_publish() {
  local version
  version=$(get_state "version")

  info "Publishing to npm..."
  npm publish

  success "Published glassbox@${version} to npm"
}

step_git_push() {
  local version
  version=$(get_state "version")
  local tag="v${version}"

  if confirm "Push commit and tag to remote?"; then
    git push
    git push origin "$tag"
    success "Pushed to remote"
  else
    warn "Skipped push. Run manually:"
    echo "    git push && git push origin ${tag}"
  fi
}


# --- Main ---
main() {
  echo ""
  echo -e "${BOLD}  Glassbox Release${RESET}"
  echo ""

  init_state

  local resume_step
  resume_step=$(get_step)
  if [[ -n "$resume_step" && "$resume_step" -gt 0 ]]; then
    warn "Found saved progress (step ${resume_step}/10)."
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

  # Step 2: Version
  if ! past_step 2; then
    echo ""
    step_version
    set_step 2
  fi

  # Step 3: Release notes
  if ! past_step 3; then
    step_release_notes
    set_step 3
  fi

  # Step 4: Review
  if ! past_step 4; then
    step_review
    if ! confirm "Proceed with this release?"; then
      warn "Aborted. State saved — run again to resume or edit."
      exit 0
    fi
    set_step 4
  fi

  # Step 5: Update version in package.json + Cargo.toml + tauri.conf.json
  if ! past_step 5; then
    echo ""
    step_update_version
    set_step 5
  fi

  # Step 6: Update CHANGELOG.md
  if ! past_step 6; then
    echo ""
    step_changelog
    set_step 6
  fi

  # Step 7: Build
  if ! past_step 7; then
    echo ""
    step_build
    set_step 7
  fi

  # Step 8: Git commit + tag
  if ! past_step 8; then
    step_git_tag
    set_step 8
  fi

  # Step 9: Publish to npm
  if ! past_step 9; then
    step_publish
    set_step 9
  fi

  # Step 10: Push
  echo ""
  step_git_push

  # Done — clean up
  echo ""
  success "Release complete!"
  cleanup_state
}

main "$@"
