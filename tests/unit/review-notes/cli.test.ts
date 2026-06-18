/**
 * GB-895 (P1) — the `glassbox note` writer CLI: argument parsing and the
 * end-to-end write into `.pr-notes/`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseNoteAdd, runNoteCli } from '../../../src/review-notes/cli.js';

describe('parseNoteAdd', () => {
  it('parses a full add invocation', () => {
    const p = parseNoteAdd(['--file', 'src/x.ts', '--lines', '10-12', '--kind', 'rationale', '--confidence', '0.8', '--rank', '70', '--ticket', 'GB-895', '--producer', 'Claude Code', '--body', 'why']);
    expect(p).toMatchObject({ file: 'src/x.ts', startLine: 10, endLine: 12, kind: 'rationale', confidence: 0.8, rank: 70, ticket: 'GB-895', producer: 'Claude Code', body: 'why', bodyStdin: false });
  });

  it('accepts a single line and marks stdin body', () => {
    const p = parseNoteAdd(['--file', 'a.ts', '--lines', '5', '--kind', 'proof', '--body', '-']);
    expect(p.startLine).toBe(5);
    expect(p.endLine).toBe(5);
    expect(p.bodyStdin).toBe(true);
  });

  it('rejects missing required flags and bad values', () => {
    expect(() => parseNoteAdd(['--lines', '1', '--kind', 'proof', '--body', 'x'])).toThrow(/--file is required/);
    expect(() => parseNoteAdd(['--file', 'a', '--lines', '1', '--kind', 'nope', '--body', 'x'])).toThrow(/--kind must be one of/);
    expect(() => parseNoteAdd(['--file', 'a', '--lines', 'abc', '--kind', 'proof', '--body', 'x'])).toThrow(/--lines must be/);
    expect(() => parseNoteAdd(['--file', 'a', '--lines', '1', '--kind', 'proof', '--confidence', '2', '--body', 'x'])).toThrow(/--confidence must be between 0 and 1/);
    expect(() => parseNoteAdd(['--file', 'a', '--lines', '5-3', '--kind', 'proof', '--body', 'x'])).toThrow(/start <= end/);
  });
});

describe('runNoteCli', () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'glassbox-notecli-'));
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src/x.ts'), 'a\nb\nc\n', 'utf-8');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes a note to .pr-notes/ for the given cwd', async () => {
    await runNoteCli(['add', '--file', 'src/x.ts', '--lines', '1-2', '--kind', 'rationale', '--body', 'hello'], { cwd: repo });
    expect(existsSync(join(repo, '.pr-notes/notes/src/x.ts.000000.sarif'))).toBe(true);
  });

  it('rejects a file outside the repo', async () => {
    await expect(runNoteCli(['add', '--file', '../escape.ts', '--lines', '1', '--kind', 'proof', '--body', 'x'], { cwd: repo }))
      .rejects.toThrow(/inside the repository/);
  });

  it('errors on an unknown subcommand', async () => {
    await expect(runNoteCli(['frobnicate'], { cwd: repo })).rejects.toThrow(/unknown 'note' subcommand/);
  });
});
