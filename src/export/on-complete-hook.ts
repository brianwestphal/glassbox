import { spawn } from 'child_process';
import { appendFileSync } from 'fs';
import { join } from 'path';

/**
 * The `--on-complete <command>` hook (doc 2 / GB-974). When a review is
 * **explicitly completed** (the Complete Review button), Glassbox runs a
 * user-supplied command so a project can act on the result programmatically —
 * e.g. read the structured JSON export (doc 6) and file tickets — with no AI in
 * the loop. This is the generic generalization of the "Send to Claude" channel
 * button.
 *
 * Security (doc 14): the command is supplied by the user on their **own** CLI
 * invocation and runs on a localhost-only server. It is never taken from network
 * input — there is no API to set it — so this introduces no remote-execution
 * surface beyond what the user already controls on their machine.
 *
 * The hook runs **only** on explicit completion, never on the debounced
 * per-annotation auto-export. The review is already marked completed and exported
 * before the hook runs, so a hook that fails or is absent never affects the
 * review's state — completion always succeeds.
 */

export interface OnCompleteHookResult {
  /** Whether a command was configured and an attempt was made. */
  ran: boolean;
  /** True when the command exited 0 (or no command was configured). */
  ok: boolean;
  /** Process exit code, or null if it never started / was signalled. */
  exitCode: number | null;
  /** Populated when the command couldn't be spawned (e.g. not found). */
  error?: string;
}

export interface OnCompleteHookContext {
  reviewId: string;
  repoRoot: string;
  /** Absolute path to the JSON export (doc 6) — the machine-readable payload. */
  jsonPath: string;
  /** Absolute path to the markdown export. */
  markdownPath: string;
}

/**
 * Run the on-complete command (via the shell, so a full command string works),
 * passing the export paths through the environment. Captures combined output to
 * `<repoRoot>/.glassbox/on-complete.log` and resolves with the outcome. Never
 * throws — a spawn failure or non-zero exit is reported, not propagated, so the
 * completion request that triggered it can't be broken by a bad hook.
 */
export function runOnCompleteHook(
  command: string | null,
  ctx: OnCompleteHookContext,
): Promise<OnCompleteHookResult> {
  if (command === null || command.trim() === '') {
    return Promise.resolve({ ran: false, ok: true, exitCode: 0 });
  }

  const logPath = join(ctx.repoRoot, '.glassbox', 'on-complete.log');
  const log = (s: string): void => {
    try {
      appendFileSync(logPath, s);
    } catch {
      /* logging is best-effort */
    }
  };

  return new Promise<OnCompleteHookResult>((resolve) => {
    log(`\n=== on-complete ${new Date().toISOString()} — review ${ctx.reviewId} ===\n$ ${command}\n`);
    let child;
    try {
      child = spawn(command, {
        shell: true,
        cwd: ctx.repoRoot,
        env: {
          ...process.env,
          GLASSBOX_REVIEW_JSON: ctx.jsonPath,
          GLASSBOX_REVIEW_MD: ctx.markdownPath,
          GLASSBOX_REVIEW_ID: ctx.reviewId,
          GLASSBOX_REPO_ROOT: ctx.repoRoot,
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(`spawn failed: ${error}\n`);
      resolve({ ran: true, ok: false, exitCode: null, error });
      return;
    }

    child.stdout.on('data', (d: Buffer) => { log(d.toString()); });
    child.stderr.on('data', (d: Buffer) => { log(d.toString()); });
    child.on('error', (err: Error) => {
      log(`error: ${err.message}\n`);
      resolve({ ran: true, ok: false, exitCode: null, error: err.message });
    });
    child.on('close', (code) => {
      log(`exited with code ${String(code)}\n`);
      resolve({ ran: true, ok: code === 0, exitCode: code });
    });
  });
}
