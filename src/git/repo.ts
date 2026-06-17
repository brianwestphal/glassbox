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
