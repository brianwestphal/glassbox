#!/usr/bin/env bash
# Seeds the glassbox-testing fixture repo with commits that each exercise one
# diff SHAPE that glassbox's own history can't cleanly show (non-code files,
# binary files, renames, deletes, long minified lines, image swaps, pure adds).
#
# Fully reproducible: it rebuilds from an orphan branch with FIXED author/committer
# dates, so re-running produces byte-identical commits and therefore the SAME
# SHAs every time. The pinned SHAs in scripts/ground-truth/scenes.ts reference
# this history; if you change a fixture, re-run this, `git push --force`, and
# re-pin the printed SHAs.
#
# Usage: bash scripts/ground-truth/build-testing-fixtures.sh
set -euo pipefail

GLASSBOX_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPO="$GLASSBOX_ROOT/external/glassbox-testing"
ICONS="$GLASSBOX_ROOT/src-tauri/icons"

if [ ! -d "$REPO/.git" ]; then
  echo "Expected a clone at $REPO — run: git clone git@github.com:brianwestphal/glassbox-testing.git external/glassbox-testing" >&2
  exit 1
fi

# Fixed identity + dates → deterministic SHAs across machines and reruns.
export GIT_AUTHOR_NAME="Brian Westphal"
export GIT_AUTHOR_EMAIL="brian.westphal@bleugris.com"
export GIT_COMMITTER_NAME="Brian Westphal"
export GIT_COMMITTER_EMAIL="brian.westphal@bleugris.com"
N=0
commit() { # commit "<message>"
  N=$((N + 1))
  local d="2025-01-0${N}T12:00:00 +0000"
  GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" git commit -q -m "$1"
}

cd "$REPO"
git checkout --orphan _rebuild >/dev/null 2>&1 || git checkout -B _rebuild
git rm -rf . >/dev/null 2>&1 || true
rm -rf app config docs legacy vendor data assets media 2>/dev/null || true
mkdir -p app config docs legacy vendor data assets media

# ---- (1) Seed: many new files (this root commit can't be `--commit`-diffed) --
cat > app/main.ts <<'EOF'
export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}
EOF
cat > README.md <<'EOF'
# Glassbox Testing Fixtures

A throwaway repo of crafted commits that exercise specific **diff shapes** for
the Glassbox ground-truth screenshot suite. Do not depend on this content.

- Non-code files (Markdown / JSON / YAML)
- Renames, deletes, pure additions
- Binary files and minified long-line files
- Image swaps
EOF
cat > config/data.json <<'EOF'
{
  "name": "fixtures",
  "version": 1,
  "features": ["diff", "rename", "binary"],
  "enabled": true
}
EOF
cat > config/app.yaml <<'EOF'
service: fixtures
port: 8080
features:
  - diff
  - rename
logging:
  level: info
EOF
cat > docs/old-name.md <<'EOF'
# Module Guide

This document will be renamed to exercise Glassbox's rename detection.
EOF
cat > legacy/deprecated.txt <<'EOF'
This file exists only to be deleted in a later commit.
EOF
cp "$ICONS/Square89x89Logo.png" assets/logo.png
git add -A
commit "Seed fixture project (code, docs, config, image, soon-to-rename/delete files)"

# ---- (2) Pure addition: a brand-new code file ----
cat > app/helper.ts <<'EOF'
/** A small utility module added in its own commit to exercise a pure-addition
 *  diff (a brand-new file, additions only). */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
EOF
git add -A
commit "Add a new helper module (pure-addition diff)"

# ---- (3) Non-code edits (Markdown + JSON + YAML) ----
cat >> README.md <<'EOF'

## Status

Seeded and ready for diff-shape captures.
EOF
sed -i.bak 's/"version": 1/"version": 2/' config/data.json && rm -f config/data.json.bak
sed -i.bak 's/level: info/level: debug/' config/app.yaml && rm -f config/app.yaml.bak
git add -A
commit "Edit docs and config (Markdown + JSON + YAML, no code)"

# ---- (4) Rename (with a small edit so the body shows too) ----
git mv docs/old-name.md docs/new-name.md
printf '\nRenamed from old-name.md.\n' >> docs/new-name.md
git add -A
commit "Rename docs/old-name.md -> docs/new-name.md"

# ---- (5) Delete ----
git rm -q legacy/deprecated.txt
commit "Remove the deprecated legacy file"

# ---- (6) Long minified line (truncation, GB-821) ----
node -e 'const f=require("fs"); let s="export const SPRITE="+JSON.stringify("M0 0"+"l4 0 0 4-4 0z".repeat(4000))+";"; f.writeFileSync("vendor/bundle.min.js", s+"\n");'
git add -A
commit "Add a minified vendor bundle (one very long line)"

# ---- (7) Binary non-image file (null bytes -> git treats as binary) ----
node -e 'const f=require("fs"); const b=Buffer.alloc(2048); for(let i=0;i<b.length;i++) b[i]=(i*37)%256; f.writeFileSync("data/blob.bin", b);'
git add -A
commit "Add a binary (non-image) data blob"

# ---- (8) Image swap (PNG old -> new, different dimensions => image diff) ----
cp "$ICONS/Square310x310Logo.png" assets/logo.png
git add -A
commit "Swap the logo image (PNG, larger dimensions)"

git branch -M _rebuild main

echo
echo "==== Fixture commits (pin these full SHAs in scenes.ts) ===="
git log --reverse --pretty='%H  %s'
echo
echo "Next: push with  git -C external/glassbox-testing push -u origin main --force"
