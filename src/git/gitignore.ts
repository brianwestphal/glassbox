/**
 * Automatic `.gitignore` management for the `.glassbox/` review directory
 * (doc 27). At launch, inside a git repo, Glassbox ensures the `.gitignore`
 * ignores the contents of `.glassbox/` while keeping the per-project
 * `settings.json` tracked:
 *
 *   /.glassbox/*
 *   !/.glassbox/settings.json
 *
 * The contents-glob (`/*`) + negation is deliberate: git won't re-include a file
 * inside a fully-ignored directory, so `.glassbox/` alone would also ignore
 * `settings.json`. Ignoring the *contents* leaves the directory itself visible to
 * git, so the `!` re-include for `settings.json` works.
 *
 * Opt-out (doc 27, unusual): if the `.gitignore` already contains a *commented*
 * line matching our pattern (e.g. `# /.glassbox/*`), the user has explicitly
 * taken control — Glassbox leaves the file untouched.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';

import { isGitRepo } from './repo.js';

/** The canonical block Glassbox keeps in `.gitignore`. */
export const GLASSBOX_GITIGNORE_LINES = ['/.glassbox/*', '!/.glassbox/settings.json'] as const;

/** Whether a (trimmed, comment-stripped) token is one of "our" `.glassbox`
 *  patterns — `.glassbox`, `/.glassbox`, `.glassbox/`, `.glassbox/*`,
 *  `!/.glassbox/settings.json`, etc. Used to find stale entries to replace and
 *  commented opt-out markers. */
function isGlassboxPattern(token: string): boolean {
  const core = token.replace(/^!/, '').replace(/^\//, '').trim();
  return core === '.glassbox' || core.startsWith('.glassbox/');
}

/** An uncommented line that is one of our `.glassbox` patterns. */
function isActiveGlassboxLine(line: string): boolean {
  const t = line.trim();
  return t !== '' && !t.startsWith('#') && isGlassboxPattern(t);
}

/** A commented line whose body matches one of our patterns → explicit opt-out. */
function isCommentedGlassboxLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('#')) return false;
  return isGlassboxPattern(t.replace(/^#+/, '').trim());
}

/**
 * Compute the desired `.gitignore` content given its current content (or `null`
 * when the file doesn't exist). Pure + idempotent: returns `changed: false` when
 * nothing needs doing (already correct, or the user opted out via a comment).
 */
export function computeGitignore(existing: string | null): { changed: boolean; content: string } {
  const block = GLASSBOX_GITIGNORE_LINES.join('\n');

  if (existing === null || existing.trim() === '') {
    return { changed: true, content: block + '\n' };
  }

  const lines = existing.split('\n');

  // Explicit opt-out — a commented version of our rule means "hands off".
  if (lines.some(isCommentedGlassboxLine)) {
    return { changed: false, content: existing };
  }

  // Already exactly our block (the only `.glassbox` lines, in order)?
  const active = lines.filter(isActiveGlassboxLine).map(l => l.trim());
  if (active.length === GLASSBOX_GITIGNORE_LINES.length && active.every((l, i) => l === GLASSBOX_GITIGNORE_LINES[i])) {
    return { changed: false, content: existing };
  }

  // Rebuild: emit the canonical block where the first `.glassbox` line was, drop
  // any other stale `.glassbox` lines, keep everything else verbatim.
  const out: string[] = [];
  let inserted = false;
  for (const line of lines) {
    if (isActiveGlassboxLine(line)) {
      if (!inserted) { out.push(...GLASSBOX_GITIGNORE_LINES); inserted = true; }
      continue; // drop the stale line
    }
    out.push(line);
  }
  if (!inserted) {
    // No existing `.glassbox` entry — append (with a blank separator for tidiness).
    if (out.length > 0 && out[out.length - 1] === '') out.pop();
    if (out.length > 0) out.push('');
    out.push(...GLASSBOX_GITIGNORE_LINES);
  }

  let content = out.join('\n');
  if (!content.endsWith('\n')) content += '\n';
  return { changed: true, content };
}

/**
 * Ensure the `.gitignore` next to `glassboxDir` carries the canonical block.
 * No-ops unless `glassboxDir` is a real `.glassbox` directory inside a git repo
 * (so demo mode's tmp dir, a custom `--data-dir`, and non-repo `--diff` /
 * `--ground-truth` runs are all skipped). Returns whether the file was changed.
 */
export function ensureGlassboxGitignored(glassboxDir: string): { changed: boolean } {
  // Only manage the default `.glassbox` directory name — a custom `--data-dir`
  // wouldn't match the `/.glassbox/*` pattern anyway.
  if (basename(glassboxDir) !== '.glassbox') return { changed: false };

  const targetDir = dirname(glassboxDir);
  if (!isGitRepo(targetDir)) return { changed: false };

  const gitignorePath = join(targetDir, '.gitignore');
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : null;
  const { changed, content } = computeGitignore(existing);
  if (changed) writeFileSync(gitignorePath, content, 'utf-8');
  return { changed };
}
