import { spawnSync } from 'child_process';

import { git, scrubbedGitEnv } from './spawn.js';

// `scrubbedGitEnv` and the git spawn helpers historically lived here; they now
// live in `spawn.js` (shared with `diff.ts`) to avoid duplicating the spawn
// flags / error-enrichment shape. Re-export `scrubbedGitEnv` so existing
// importers (`diff.ts`, `image.ts`, tests) don't need to change.
export { scrubbedGitEnv };

export function getRepoRoot(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

export function getRepoName(cwd: string): string {
  const root = getRepoRoot(cwd);
  return root.split('/').pop() ?? 'unknown';
}

export function isGitRepo(cwd: string): boolean {
  try {
    git(['rev-parse', '--is-inside-work-tree'], cwd);
    return true;
  } catch {
    return false;
  }
}

export function getHeadCommit(cwd: string): string {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8', env: scrubbedGitEnv() }).stdout.trim();
}

/** Resolved short hash + subject + full message for a commit (docs/20 §20.6,
 *  GB-1142). Returns null when the sha can't be resolved in this repo (a note
 *  authored in a different clone, a shallow checkout, a bad/synthetic sha), so
 *  the caller can fall back to showing the short sha alone. */
export function getCommitInfo(cwd: string, sha: string): { shortSha: string; subject: string; message: string } | null {
  // One call: `%h` (abbrev hash), a NUL, `%s` (subject), a NUL, `%B` (raw body).
  // NUL separators so a subject/body containing our delimiter can't confuse the
  // split. `-s` suppresses the diff.
  const res = spawnSync('git', ['show', '-s', '--format=%h%x00%s%x00%B', sha], {
    cwd, encoding: 'utf-8', env: scrubbedGitEnv(),
  });
  if (res.status !== 0 || typeof res.stdout !== 'string' || res.stdout === '') return null;
  const parts = res.stdout.split('\0');
  if (parts.length < 3) return null;
  return { shortSha: parts[0].trim(), subject: parts[1].trim(), message: parts[2].trim() };
}
