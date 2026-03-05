# Glassbox

A local code review tool for AI-generated code. Run it from any git repository to get a browser-based diff viewer where you can annotate lines with categorized feedback. When you're done, export your review as structured markdown that AI tools can read and act on.

## Install

```bash
npm install -g glassbox
```

Or for development:

```bash
git clone <repo-url>
cd glassbox
npm install
npm run build
npm link
```

## Usage

Run from inside any git repository:

```bash
# Review uncommitted changes (staged + unstaged + untracked)
glassbox --uncommitted

# Review only staged changes
glassbox --staged

# Review only unstaged changes
glassbox --unstaged

# Review a specific commit
glassbox --commit abc123

# Review a range of commits
glassbox --range main..feature-branch

# Review current branch vs another branch
glassbox --branch main

# Review specific files
glassbox --files "src/**/*.ts,lib/*.js"

# Review entire codebase
glassbox --all
```

### Options

| Flag | Description |
|------|-------------|
| `--uncommitted` | Staged + unstaged + untracked changes |
| `--staged` | Only staged changes |
| `--unstaged` | Only unstaged changes |
| `--commit <sha>` | Changes from a specific commit |
| `--range <from>..<to>` | Changes between two refs |
| `--branch <name>` | Current branch vs the named branch |
| `--files <patterns>` | Specific files (comma-separated globs) |
| `--all` | Entire codebase (all tracked files) |
| `--port <number>` | Port to run on (default: 4173) |
| `--resume` | Resume the latest in-progress review for this mode |
| `--check-for-updates` | Check for a newer version on npm |
| `--help` | Show help |

## Features

### Diff Viewer

The web UI shows diffs with syntax-highlighted add/remove/context lines and old+new line numbers. Toggle between split and unified diff modes. Long lines can be wrapped or scrolled horizontally (with synchronized scrolling in split mode).

### Annotations

Click any line in the diff to add an annotation. Each annotation has a **category** and **content**:

| Category | Purpose |
|----------|---------|
| **Bug** | Code defect that needs fixing |
| **Fix needed** | Specific change required |
| **Style** | Stylistic preference |
| **Pattern to follow** | Good pattern — keep using it |
| **Pattern to avoid** | Anti-pattern — stop using it |
| **Note** | General observation |
| **Remember (for AI)** | Rule/preference that should be persisted to AI config files |

You can add multiple annotations to the same line, each with a different category. Edit or delete annotations at any time.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `Down` | Next file |
| `k` / `Up` | Previous file |
| `Cmd+Enter` | Save annotation |
| `Escape` | Cancel annotation |

### Session Persistence

Reviews are saved to a local PGLite database at `~/.glassbox/data/`. Use `--resume` to pick up where you left off:

```bash
glassbox --uncommitted --resume
```

### Review History

Visit `/history` in the web UI to see all previous reviews for the current repository. You can reopen completed reviews, delete individual reviews, or bulk-delete completed/all reviews.

### Completing a Review

Click **Complete Review** to finish. This:

1. Marks the review as completed
2. Exports all annotations to `.glassbox/latest-review.md` in the repository
3. Archives a copy as `.glassbox/review-<id>.md`

## AI Integration

The exported review file (`.glassbox/latest-review.md`) is structured so AI coding tools can parse and act on it.

### With Claude Code

After completing a review, tell Claude Code:

```
Read .glassbox/latest-review.md and apply the review feedback.
```

Claude Code will:
- Fix bugs and apply changes marked as **bug** or **fix**
- Apply **style** preferences to indicated lines and similar patterns
- Continue using **pattern-follow** patterns in new code
- Refactor **pattern-avoid** anti-patterns
- Update CLAUDE.md with **remember** items for long-term retention

### With Other AI Tools

The export format is plain markdown with clear structure. Any AI tool that can read files can consume it. The "Instructions for AI Tools" section at the bottom of each export explains how to interpret each annotation category.

### Adding `.glassbox/` to `.gitignore`

Review exports are meant to be ephemeral working files. Add this to your `.gitignore`:

```
.glassbox/
```

Or commit them if you want review history in version control.

## How It Works

1. **CLI** parses arguments and determines which git diff to generate
2. **Git integration** runs `git diff` (or `git ls-files` for `--all` mode) and parses the unified diff output into structured data
3. **PGLite database** stores reviews, files, and annotations locally
4. **Hono web server** serves a single-page review UI with server-rendered HTML
5. **Client-side JS** (vanilla, no framework) handles interactivity: file selection, annotation forms, keyboard navigation
6. **Export** generates structured markdown grouped by file with category labels and AI-readable instructions

## Development

```bash
npm run dev -- --uncommitted    # Run with tsx (hot reload)
npm run build                   # Build to dist/cli.js
```

### Tech Stack

- **TypeScript** with a custom server-side JSX runtime (no React)
- **Hono** for the HTTP server
- **PGLite** (embedded PostgreSQL) for persistence
- **tsup** for building a single-file CLI bundle

## Requirements

- Node.js 20+
- Git
