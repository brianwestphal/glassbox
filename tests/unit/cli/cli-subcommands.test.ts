/**
 * Unit tests for the standalone `glassbox` subcommand handlers
 * (src/cli-subcommands.ts): `glassbox note`, `glassbox ground-truth promote`,
 * and `--register-difftool` / `--unregister-difftool`.
 *
 * Every handler ends in `process.exit`, so the exit spy throws a sentinel to
 * stop execution the way a real exit would. Note: a handler that reaches a
 * successful `process.exit(0)` inside a try block has that sentinel caught by
 * its own catch and re-exits with 1 — assertions therefore check the FIRST
 * exit call, which is the outcome the production process observes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleDifftoolRegistration,
  handleGroundTruthPromote,
  handleNoteSubcommand,
} from '../../../src/cli-subcommands.js';

const runNoteCli = vi.hoisted(() => vi.fn());
vi.mock('../../../src/review-notes/cli.js', () => ({ runNoteCli }));

const promoteGroundTruthBaselines = vi.hoisted(() => vi.fn());
vi.mock('../../../src/ground-truth/promote.js', () => ({ promoteGroundTruthBaselines }));

const registerDifftool = vi.hoisted(() => vi.fn());
const unregisterDifftool = vi.hoisted(() => vi.fn());
const getDifftoolStatus = vi.hoisted(() => vi.fn());
vi.mock('../../../src/git/difftool.js', () => ({ registerDifftool, unregisterDifftool, getDifftoolStatus }));

class ExitSentinel extends Error {
  constructor(public code: number) { super(`process.exit(${String(code)})`); }
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitSentinel(code ?? 0);
  }) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/** Run a handler to its (sentinel-thrown) exit and return the FIRST exit code. */
async function firstExitCode(run: () => Promise<never>): Promise<number> {
  await expect(run()).rejects.toThrow(ExitSentinel);
  expect(exitSpy).toHaveBeenCalled();
  return exitSpy.mock.calls[0][0] as number;
}

function logged(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
}

describe('handleNoteSubcommand', () => {
  it('forwards the args to runNoteCli and exits 0 on success', async () => {
    runNoteCli.mockResolvedValue(undefined);
    const code = await firstExitCode(() => handleNoteSubcommand(['add', '--file', 'a.ts']));
    expect(runNoteCli).toHaveBeenCalledWith(['add', '--file', 'a.ts']);
    expect(code).toBe(0);
  });

  it('prints the error message and exits 1 when runNoteCli throws an Error', async () => {
    runNoteCli.mockRejectedValue(new Error('bad note flag'));
    const code = await firstExitCode(() => handleNoteSubcommand(['add']));
    expect(code).toBe(1);
    expect(logged(errorSpy)).toContain('Error: bad note flag');
  });

  it('stringifies a non-Error throw', async () => {
    runNoteCli.mockRejectedValue('plain string failure');
    const code = await firstExitCode(() => handleNoteSubcommand([]));
    expect(code).toBe(1);
    expect(logged(errorSpy)).toContain('Error: plain string failure');
  });
});

describe('handleGroundTruthPromote', () => {
  it('prints usage and exits 1 when the manifest arg is missing', async () => {
    const code = await firstExitCode(() => handleGroundTruthPromote(undefined));
    expect(code).toBe(1);
    expect(logged(errorSpy)).toContain('Usage: glassbox ground-truth promote');
    expect(promoteGroundTruthBaselines).not.toHaveBeenCalled();
  });

  it('treats an empty-string manifest arg as missing', async () => {
    const code = await firstExitCode(() => handleGroundTruthPromote(''));
    expect(code).toBe(1);
    expect(promoteGroundTruthBaselines).not.toHaveBeenCalled();
  });

  it('logs each promoted baseline plus a count and exits 0', async () => {
    promoteGroundTruthBaselines.mockReturnValue({
      promoted: [
        { key: 'a.png', from: '/actual/a.png', to: '/base/a.png' },
        { key: 'b.png', from: '/actual/b.png', to: '/base/b.png' },
      ],
      skipped: [],
    });
    const code = await firstExitCode(() => handleGroundTruthPromote('manifest.json'));
    expect(code).toBe(0);
    const out = logged(logSpy);
    expect(out).toContain('Promoted a.png');
    expect(out).toContain('Promoted b.png');
    expect(out).toContain('Promoted 2 baseline(s).');
  });

  it('explains how to enable promotion when nothing has expectedKind previous-actual', async () => {
    promoteGroundTruthBaselines.mockReturnValue({ promoted: [], skipped: [] });
    const code = await firstExitCode(() => handleGroundTruthPromote('manifest.json'));
    expect(code).toBe(0);
    expect(logged(logSpy)).toContain('Nothing to promote');
    expect(logged(logSpy)).toContain('previous-actual');
  });

  it('warns for real skips but suppresses expectedKind-mismatch skips', async () => {
    promoteGroundTruthBaselines.mockReturnValue({
      promoted: [{ key: 'a.png', from: '/x', to: '/y' }],
      skipped: [
        { key: 'spec.png', reason: 'expectedKind is "spec", not "previous-actual"' },
        { key: 'gone.png', reason: 'actual image missing' },
      ],
    });
    await firstExitCode(() => handleGroundTruthPromote('manifest.json'));
    const warned = logged(warnSpy);
    expect(warned).toContain('Skipped gone.png: actual image missing');
    expect(warned).not.toContain('spec.png');
  });

  it('prints the error and exits 1 when promotion throws', async () => {
    promoteGroundTruthBaselines.mockImplementation(() => {
      throw new Error('manifest unreadable');
    });
    const code = await firstExitCode(() => handleGroundTruthPromote('manifest.json'));
    expect(code).toBe(1);
    expect(logged(errorSpy)).toContain('Error: manifest unreadable');
  });
});

describe('handleDifftoolRegistration', () => {
  it('registers at global scope by default and exits 0', async () => {
    registerDifftool.mockReturnValue({ ok: true, replacedTool: null });
    const code = await firstExitCode(() => handleDifftoolRegistration('register', false, false));
    expect(code).toBe(0);
    expect(registerDifftool).toHaveBeenCalledWith({ scope: 'global', force: false });
    expect(logged(logSpy)).toContain('--global scope');
    expect(logged(logSpy)).not.toContain('replaced previous tool');
  });

  it('registers at local scope with force and mentions the replaced tool', async () => {
    registerDifftool.mockReturnValue({ ok: true, replacedTool: 'meld' });
    const code = await firstExitCode(() => handleDifftoolRegistration('register', true, true));
    expect(code).toBe(0);
    expect(registerDifftool).toHaveBeenCalledWith({ scope: 'local', force: true });
    expect(logged(logSpy)).toContain('(replaced previous tool: meld)');
  });

  it('explains the conflict and exits 1 when another tool is registered', async () => {
    registerDifftool.mockReturnValue({ ok: false, reason: 'conflict', currentTool: 'kdiff3' });
    const code = await firstExitCode(() => handleDifftoolRegistration('register', false, false));
    expect(code).toBe(1);
    const err = logged(errorSpy);
    expect(err).toContain("'kdiff3'");
    expect(err).toContain('--force');
  });

  it('prints the git failure message and exits 1', async () => {
    registerDifftool.mockReturnValue({ ok: false, reason: 'git-failed', message: 'git not found' });
    const code = await firstExitCode(() => handleDifftoolRegistration('register', false, false));
    expect(code).toBe(1);
    expect(logged(errorSpy)).toContain('Error: git not found');
  });

  it('unregisters and reports success', async () => {
    getDifftoolStatus.mockReturnValue({ tool: 'glassbox', cmd: 'glassbox-difftool', isGlassbox: true });
    unregisterDifftool.mockReturnValue({ ok: true, removed: true });
    const code = await firstExitCode(() => handleDifftoolRegistration('unregister', false, false));
    expect(code).toBe(0);
    expect(unregisterDifftool).toHaveBeenCalledWith({ scope: 'global' });
    expect(logged(logSpy)).toContain('unregistered');
  });

  it('reports nothing-to-unregister with the current tool name', async () => {
    getDifftoolStatus.mockReturnValue({ tool: 'meld', cmd: null, isGlassbox: false });
    unregisterDifftool.mockReturnValue({ ok: true, removed: false });
    const code = await firstExitCode(() => handleDifftoolRegistration('unregister', true, false));
    expect(code).toBe(0);
    expect(unregisterDifftool).toHaveBeenCalledWith({ scope: 'local' });
    expect(logged(logSpy)).toContain('Nothing to unregister');
    expect(logged(logSpy)).toContain('meld');
  });

  it('says "none" when no tool is registered at all', async () => {
    getDifftoolStatus.mockReturnValue({ tool: null, cmd: null, isGlassbox: false });
    unregisterDifftool.mockReturnValue({ ok: true, removed: false });
    await firstExitCode(() => handleDifftoolRegistration('unregister', false, false));
    expect(logged(logSpy)).toContain('none');
  });
});
