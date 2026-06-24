/**
 * Standalone `glassbox` subcommands that fully handle their work and exit the
 * process without booting the HTTP server or touching the review DB. Split out
 * of `main()` in `cli.ts` to keep that entry point focused on the review flow.
 *
 * Each handler ends in `process.exit`, so it never returns to the caller. Heavy
 * dependencies are imported dynamically so the common review path doesn't pay
 * for code only these subcommands need.
 */
import { resolve } from 'path';

/** `glassbox note ...` — the producer-side review-note writer (doc 20). */
export async function handleNoteSubcommand(noteArgs: string[]): Promise<never> {
  const { runNoteCli } = await import('./review-notes/cli.js');
  try {
    await runNoteCli(noteArgs);
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/** `glassbox ground-truth promote <manifest>` (doc 26 P3d) — rotate baselines by
 *  copying current actuals over the `previous-actual` expecteds. No server, no
 *  review DB; Glassbox still stores no baseline state itself. */
export async function handleGroundTruthPromote(manifestArg: string | undefined): Promise<never> {
  if (manifestArg === undefined || manifestArg === '') {
    console.error('Usage: glassbox ground-truth promote <manifest.json>');
    process.exit(1);
  }
  const { promoteGroundTruthBaselines } = await import('./ground-truth/promote.js');
  try {
    const res = promoteGroundTruthBaselines(resolve(manifestArg));
    for (const p of res.promoted) console.log(`Promoted ${p.key}\n  ${p.from}\n  -> ${p.to}`);
    if (res.promoted.length === 0) {
      console.log('Nothing to promote: no comparison has expectedKind "previous-actual".');
      console.log('Mark a comparison\'s expectedKind as "previous-actual" to rotate its baseline.');
    } else {
      console.log(`Promoted ${String(res.promoted.length)} baseline(s).`);
    }
    const realSkips = res.skipped.filter(s => !s.reason.startsWith('expectedKind'));
    for (const s of realSkips) console.warn(`Skipped ${s.key}: ${s.reason}`);
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/** `--register-difftool` / `--unregister-difftool` (doc 19, GB-850) — write or
 *  remove the git difftool config and exit. */
export async function handleDifftoolRegistration(
  action: 'register' | 'unregister',
  local: boolean,
  force: boolean,
): Promise<never> {
  const { registerDifftool, unregisterDifftool, getDifftoolStatus } = await import('./git/difftool.js');
  const scope = local ? 'local' as const : 'global' as const;
  if (action === 'register') {
    const res = registerDifftool({ scope, force });
    if (res.ok) {
      const replaced = res.replacedTool !== null ? ` (replaced previous tool: ${res.replacedTool})` : '';
      console.log(`Glassbox registered as git difftool at --${scope} scope.${replaced}`);
      console.log(`Try it with: git difftool --dir-diff HEAD~1 HEAD`);
      process.exit(0);
    }
    if (res.reason === 'conflict') {
      console.error(`Error: you currently have '${res.currentTool}' set as your git difftool.`);
      console.error(`Pass --force to overwrite it with glassbox, or use --local to register only in this repo.`);
      process.exit(1);
    }
    console.error(`Error: ${res.message}`);
    process.exit(1);
  }
  // unregister
  const status = getDifftoolStatus(scope);
  const res = unregisterDifftool({ scope });
  if (res.removed) {
    console.log(`Glassbox unregistered as git difftool at --${scope} scope.`);
  } else {
    console.log(`Nothing to unregister at --${scope} scope (current tool: ${status.tool ?? 'none'}).`);
  }
  process.exit(0);
}
