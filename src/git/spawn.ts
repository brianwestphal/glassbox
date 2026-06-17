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

/**
 * Run a git subprocess and return stdout. Shared by `repo.ts` and `diff.ts`
 * (and any other internal git caller) so the spawn flags, 50 MB buffer, env
 * scrubbing, and error-enrichment shape stay identical everywhere. On a
 * non-zero exit with no stdout, throws an Error carrying `stdout` / `stderr` /
 * `status` for the caller to inspect.
 */
export function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, env: scrubbedGitEnv() });
  if (result.status === 0) return result.stdout;
  if (result.stdout !== '') return result.stdout;
  const err: Error & { stdout?: string; stderr?: string; status?: number | null } = new Error(result.stderr);
  err.stdout = result.stdout;
  err.stderr = result.stderr;
  err.status = result.status;
  throw err;
}
