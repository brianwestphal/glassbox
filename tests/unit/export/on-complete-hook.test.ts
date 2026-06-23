import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runOnCompleteHook } from '../../../src/export/on-complete-hook.js';

// doc 2 / GB-974 — the --on-complete command hook.
describe('runOnCompleteHook', () => {
  let repoRoot: string;
  const ctx = () => ({
    reviewId: 'rev1',
    repoRoot,
    jsonPath: join(repoRoot, '.glassbox', 'latest-review.json'),
    markdownPath: join(repoRoot, '.glassbox', 'latest-review.md'),
  });

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'gb-hook-'));
    // .glassbox exists by the time the hook runs (generateReviewExport mkdirs it).
    mkdirSync(join(repoRoot, '.glassbox'), { recursive: true });
  });
  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('is a no-op when no command is configured', async () => {
    expect(await runOnCompleteHook(null, ctx())).toEqual({ ran: false, ok: true, exitCode: 0 });
    expect(await runOnCompleteHook('   ', ctx())).toEqual({ ran: false, ok: true, exitCode: 0 });
  });

  it('runs the command with the export paths in the environment', async () => {
    // The hook writes its received Glassbox env vars to a file we then assert on.
    const out = join(repoRoot, 'env-capture.txt');
    const cmd = `node -e "require('fs').writeFileSync('${out.replace(/\\/g, '\\\\')}', [process.env.GLASSBOX_REVIEW_JSON, process.env.GLASSBOX_REVIEW_MD, process.env.GLASSBOX_REVIEW_ID, process.env.GLASSBOX_REPO_ROOT].join('\\n'))"`;
    const result = await runOnCompleteHook(cmd, ctx());
    expect(result).toMatchObject({ ran: true, ok: true, exitCode: 0 });
    const captured = readFileSync(out, 'utf-8').split('\n');
    expect(captured[0]).toBe(join(repoRoot, '.glassbox', 'latest-review.json'));
    expect(captured[1]).toBe(join(repoRoot, '.glassbox', 'latest-review.md'));
    expect(captured[2]).toBe('rev1');
    expect(captured[3]).toBe(repoRoot);
  });

  it('reports a non-zero exit without throwing, and completion is unaffected', async () => {
    const result = await runOnCompleteHook('exit 3', ctx());
    expect(result).toMatchObject({ ran: true, ok: false, exitCode: 3 });
  });

  it('reports a failed spawn (unknown command) without throwing', async () => {
    const result = await runOnCompleteHook('this-command-does-not-exist-xyz', ctx());
    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('captures the command output to .glassbox/on-complete.log', async () => {
    await runOnCompleteHook('echo hello-from-hook', ctx());
    const log = readFileSync(join(repoRoot, '.glassbox', 'on-complete.log'), 'utf-8');
    expect(log).toContain('hello-from-hook');
    expect(log).toContain('review rev1');
  });
});
