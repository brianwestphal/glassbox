/**
 * Regression guard for GB-927 — a failed analysis trigger must surface, not
 * spin forever.
 *
 * The bug: `startAnalysis()` resolves to a success-or-error *union*
 * (`StartAnalysisResp | StartAnalysisErrorResp`) because `apiCall` does not
 * throw on a 4xx/5xx — it parses the body, and `{ error }` is a valid variant.
 * The trigger code (`sidebar/sortMode.tsx`, `guided.ts`) did
 * `await startAnalysis(...)` and ignored the result, so an error response slid
 * straight into polling. The poll then saw status `none` (no run was created),
 * matched none of running/completed/failed, and left the analysis state stuck
 * on "running" — no error banner, no log, looked like a silent multi-minute
 * hang (which is exactly how GB-925 hid).
 *
 * The fix is to discriminate the union (`'error' in result`) and set a failed
 * state. This test runs in the default node env (no DOM needed) and scans the
 * client sources so the guard can't be reverted unnoticed: every file that
 * *calls* `startAnalysis(...)` must also handle the error variant.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const CLIENT_ROOT = join(__dirname, '..', '..', '..', 'src', 'client');

function walkClientSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'styles') continue; // SCSS partials, not TS
      out.push(...walkClientSources(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('GB-927: analysis trigger surfaces a rejected start', () => {
  // `startAnalysis({...})` is the call form; the bare identifier appears in
  // imports, which we don't want to flag.
  const callSites = walkClientSources(CLIENT_ROOT).filter(f =>
    readFileSync(f, 'utf-8').includes('startAnalysis({'),
  );

  it('finds the known trigger call sites', () => {
    // Sanity check the scan actually matches something, so a refactor that
    // renamed the call doesn't silently make this suite vacuously pass.
    // Since GB-1083 there is exactly one call site: the shared analysisEngine
    // (behaviorally covered in analysisEngine.test.ts).
    expect(callSites.length).toBeGreaterThanOrEqual(1);
  });

  it('every startAnalysis() caller discriminates the success-or-error union', () => {
    const offenders = callSites.filter(f => !readFileSync(f, 'utf-8').includes("'error' in"));
    expect(offenders, `these files call startAnalysis() but never handle the { error } variant: ${offenders.join(', ')}`).toEqual([]);
  });
});
