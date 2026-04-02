import { spawnSync } from 'child_process';

function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
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
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' }).stdout.trim();
}
