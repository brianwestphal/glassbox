import { spawnSync } from 'child_process';

/**
 * Build the environment for an internal git subprocess with `git difftool`'s
 * leaked state scrubbed out.
 *
 * When Glassbox runs as a registered `git difftool` (doc 19), git invokes our
 * wrapper with `GIT_EXTERNAL_DIFF=git-difftool--helper` (plus the per-file
 * `GIT_DIFF_PATH_COUNTER` / `GIT_DIFF_PATH_TOTAL`) exported into the tool's
 * environment, and those variables are inherited by every child process —
 * including the `git diff --no-index` / `git show` that Glassbox itself runs to
 * build the diff. With `GIT_EXTERNAL_DIFF` set, that inner git does NOT emit a
 * textual patch; it re-invokes the difftool helper, which re-launches
 * `glassbox`. The result is runaway recursion plus empty output — so the diff
 * parser sees nothing and the review reports "No changes found for the specified
 * mode" (with the desktop launcher's "Error: Server failed to start" surfacing
 * from the nested launch).
 *
 * Stripping these makes every internal git call behave as plain git, regardless
 * of how Glassbox was invoked.
 */
export function scrubbedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_EXTERNAL_DIFF;
  delete env.GIT_DIFF_PATH_COUNTER;
  delete env.GIT_DIFF_PATH_TOTAL;
  return env;
}

function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, env: scrubbedGitEnv() });
  if (result.status === 0) return result.stdout;
  if (result.stdout !== '') return result.stdout;
  const err: Error & { stdout?: string; stderr?: string; status?: number | null } = new Error(result.stderr);
  err.stdout = result.stdout;
  err.stderr = result.stderr;
  err.status = result.status;
  throw err;
}

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
