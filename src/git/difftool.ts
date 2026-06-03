/**
 * GB-850 — `git difftool` registration helpers.
 *
 * Three operations, all pure-ish wrappers over `git config`:
 *
 *  - `getDifftoolStatus()` — what's currently registered (tool name + cmd).
 *  - `registerDifftool()` — write the three keys (`diff.tool`,
 *    `difftool.glassbox.cmd`, `difftool.prompt`) at `--global` or `--local`
 *    scope. Refuses to overwrite a non-`glassbox` tool unless `force: true`.
 *  - `unregisterDifftool()` — remove only the keys we set.
 *
 * Invoked from the CLI flags (`--register-difftool` / `--unregister-difftool`
 * in `src/cli.ts`) and from the settings dialog via the
 * `/api/difftool/*` routes.
 */
import { spawnSync } from 'node:child_process';

/** The git config value we write to `difftool.glassbox.cmd`. `$MERGED` is git's
 *  repo-relative path of the file under diff; the wrapper uses it to label the
 *  appended file with its full path (`src/app.ts`) instead of a bare basename
 *  (GB-864). */
export const DIFFTOOL_CMD = 'glassbox-difftool "$LOCAL" "$REMOTE" "$MERGED"';

/** The pre-GB-864 two-argument cmd. Still recognized as "ours" so an existing
 *  registration keeps working (FR-19.13) — it falls back to a basename label —
 *  and is upgraded to {@link DIFFTOOL_CMD} on the next `--register-difftool`. */
export const DIFFTOOL_CMD_LEGACY = 'glassbox-difftool "$LOCAL" "$REMOTE"';

export type DifftoolScope = 'global' | 'local';

export interface DifftoolStatus {
  /** Value of `diff.tool` at the requested scope, or `null` if unset. */
  tool: string | null;
  /** Value of `difftool.<tool>.cmd` for whatever `tool` is set to. */
  cmd: string | null;
  /** True when `tool === 'glassbox'` AND the cmd matches what we write. */
  isGlassbox: boolean;
}

export type RegisterResult =
  | { ok: true; replacedTool: string | null }
  | { ok: false; reason: 'conflict'; currentTool: string }
  | { ok: false; reason: 'git-failed'; message: string };

export interface UnregisterResult {
  ok: true;
  /** True if anything was actually removed (vs already absent). */
  removed: boolean;
}

function git(args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { encoding: 'utf-8', cwd });
  // `spawnSync` returns `error` (with a `.code` like ENOENT / EACCES) when the
  // child fails to launch at all — in that case `status` is null and `stderr`
  // is empty, so the caller can't tell what went wrong. Surface the error's
  // code + message into stderr so the `git-failed` reason in `RegisterResult`
  // carries something actionable (GB-852).
  if (r.error !== undefined) {
    const code = (r.error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    return { status: -1, stdout: '', stderr: `spawn git failed (${code}): ${r.error.message}` };
  }
  return { status: r.status ?? -1, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function readConfig(key: string, scope: DifftoolScope, cwd?: string): string | null {
  const r = git(['config', `--${scope}`, '--get', key], cwd);
  return r.status === 0 ? r.stdout : null;
}

/** Read the current `diff.tool` + corresponding `difftool.<tool>.cmd` at `scope`. */
export function getDifftoolStatus(scope: DifftoolScope = 'global', cwd?: string): DifftoolStatus {
  const tool = readConfig('diff.tool', scope, cwd);
  if (tool === null) return { tool: null, cmd: null, isGlassbox: false };
  const cmd = readConfig(`difftool.${tool}.cmd`, scope, cwd);
  const isGlassbox = tool === 'glassbox' && (cmd === DIFFTOOL_CMD || cmd === DIFFTOOL_CMD_LEGACY);
  return { tool, cmd, isGlassbox };
}

/**
 * Idempotent registration. Returns `{ ok: true, replacedTool }` after writing
 * the three keys. If a non-`glassbox` tool is currently set and `force` is
 * not true, returns `{ ok: false, reason: 'conflict', currentTool }` and
 * makes no changes — the caller (CLI or settings dialog) decides how to
 * surface the choice.
 */
export function registerDifftool(opts: { scope?: DifftoolScope; force?: boolean; cwd?: string } = {}): RegisterResult {
  const scope = opts.scope ?? 'global';
  const status = getDifftoolStatus(scope, opts.cwd);

  // Already registered with the current cmd → no-op success. A legacy cmd is
  // recognized as ours (so it's not a "conflict") but still rewritten below, so
  // re-registering upgrades it to the `$MERGED` form (GB-864).
  if (status.tool === 'glassbox' && status.cmd === DIFFTOOL_CMD) return { ok: true, replacedTool: null };

  // Something else is configured; require `force` to overwrite.
  if (status.tool !== null && status.tool !== 'glassbox' && opts.force !== true) {
    return { ok: false, reason: 'conflict', currentTool: status.tool };
  }

  const replacedTool = status.tool !== null && status.tool !== 'glassbox' ? status.tool : null;

  // Write the three keys. `git config --set` is idempotent; we just set.
  const sets: [string, string][] = [
    ['diff.tool', 'glassbox'],
    ['difftool.glassbox.cmd', DIFFTOOL_CMD],
    ['difftool.prompt', 'false'],
  ];
  for (const [key, value] of sets) {
    const r = git(['config', `--${scope}`, key, value], opts.cwd);
    if (r.status !== 0) {
      // Include the key being written and the exit status alongside any
      // stderr so the failure can be diagnosed without a debugger (GB-852).
      const detail = r.stderr || `(no stderr; exit ${String(r.status)})`;
      return { ok: false, reason: 'git-failed', message: `\`git config --${scope} ${key}\` failed: ${detail}` };
    }
  }
  return { ok: true, replacedTool };
}

/**
 * Remove the three keys we set. Returns `removed: true` only if `diff.tool`
 * was `glassbox` (so we don't unset a third party's tool just because the
 * cmd happens to be ours). `difftool.prompt` is removed regardless — we
 * own that setting at the global default level.
 */
export function unregisterDifftool(opts: { scope?: DifftoolScope; cwd?: string } = {}): UnregisterResult {
  const scope = opts.scope ?? 'global';
  const status = getDifftoolStatus(scope, opts.cwd);

  if (status.tool !== 'glassbox') {
    // Nothing to unregister — leave third-party tools alone.
    return { ok: true, removed: false };
  }

  // `git config --unset` returns 5 when the key doesn't exist; treat that as success.
  const tryUnset = (key: string) => {
    const r = git(['config', `--${scope}`, '--unset', key], opts.cwd);
    if (r.status !== 0 && r.status !== 5) {
      // Best-effort: don't bail; the user might end up in a half-state but
      // that's better than leaving the call hanging on a partial unset.
      console.error(`git config --unset ${key} failed: ${r.stderr}`);
    }
  };

  tryUnset('diff.tool');
  tryUnset('difftool.glassbox.cmd');
  tryUnset('difftool.prompt');
  return { ok: true, removed: true };
}
