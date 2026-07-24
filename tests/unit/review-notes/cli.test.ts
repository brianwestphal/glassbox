/**
 * GB-895 (P1) — the `glassbox note` writer CLI: argument parsing and the
 * end-to-end write into `.pr-notes/`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseNoteAdd, runNoteCli } from '../../../src/review-notes/cli.js';
import { reviewNoteInstructions } from '../../../src/review-notes/instructions.js';
import { writeReviewNote } from '../../../src/review-notes/store.js';
import { NOTE_KINDS } from '../../../src/review-notes/types.js';

describe('reviewNoteInstructions (GB-900)', () => {
  it('documents the glassbox note surface, the lifecycle, and every kind', () => {
    const text = reviewNoteInstructions();
    expect(text).toContain('glassbox note add');
    expect(text).toContain('glassbox note update');
    expect(text).toContain('glassbox note remove');
    expect(text).toContain('glassbox note coalesce');
    expect(text).toContain('.pr-notes/');
    for (const kind of NOTE_KINDS) expect(text).toContain(kind);
  });

  it('instructs the AI-driven cross-cutting consolidation pass (GB-903)', () => {
    const text = reviewNoteInstructions();
    expect(text).toContain('Final consolidation pass');
    // The pass uses the existing update/remove primitives, not a new link command.
    expect(text).toContain('Merge near-duplicates');
    expect(text).toContain('Link related notes across files');
    expect(text).not.toContain('glassbox note link');
  });

  it('induces diagram-as-proof artifacts — Mermaid SOURCE via --artifact (doc 20 §20.5)', () => {
    const text = reviewNoteInstructions();
    expect(text).toContain('--artifact <path>');
    expect(text).toContain('Proof artifacts');
    // Diagrams as source (Mermaid), never rendered images / ASCII art.
    expect(text).toContain('Mermaid SOURCE');
    expect(text).toContain('.mmd');
    expect(text).toContain('never attach a rendered diagram image');
    expect(text).toContain('.pr-notes/artifacts/');
    // The §20.5 economy rules: prefer text/source, one artifact per claim.
    expect(text).toContain('one artifact per *claim*');
  });
});

describe('parseNoteAdd', () => {
  it('parses a full add invocation', () => {
    const p = parseNoteAdd(['--file', 'src/x.ts', '--lines', '10-12', '--kind', 'rationale', '--confidence', '0.8', '--rank', '70', '--ticket', 'GB-895', '--producer', 'Claude Code', '--body', 'why']);
    expect(p).toMatchObject({ file: 'src/x.ts', startLine: 10, endLine: 12, kind: 'rationale', confidence: 0.8, rank: 70, ticket: 'GB-895', producer: 'Claude Code', body: 'why', bodyStdin: false });
  });

  it('collects repeatable --artifact flags (GB-898)', () => {
    const p = parseNoteAdd(['--file', 'a.ts', '--lines', '1', '--kind', 'proof', '--artifact', 'out.txt', '--artifact', 'diagram.mmd', '--body', 'x']);
    expect(p.artifacts).toEqual(['out.txt', 'diagram.mmd']);
  });

  it('defaults artifacts to an empty array', () => {
    const p = parseNoteAdd(['--file', 'a.ts', '--lines', '1', '--kind', 'proof', '--body', 'x']);
    expect(p.artifacts).toEqual([]);
  });

  it('collects repeatable --related <file:line> flags (GB-1097)', () => {
    const p = parseNoteAdd(['--file', 'a.ts', '--lines', '1', '--kind', 'proof', '--related', 'src/a.ts:42', '--related', 'src/b.ts:7', '--body', 'x']);
    expect(p.related).toEqual([{ uri: 'src/a.ts', line: 42 }, { uri: 'src/b.ts', line: 7 }]);
  });

  it('defaults related to an empty array', () => {
    expect(parseNoteAdd(['--file', 'a.ts', '--lines', '1', '--kind', 'proof', '--body', 'x']).related).toEqual([]);
  });

  it('rejects a --related value without a line', () => {
    expect(() => parseNoteAdd(['--file', 'a.ts', '--lines', '1', '--kind', 'proof', '--related', 'src/a.ts', '--body', 'x']))
      .toThrow(/--related must be <file:line>/);
  });

  it('rejects a 0 or negative --related line', () => {
    expect(() => parseNoteAdd(['--file', 'a.ts', '--lines', '1', '--kind', 'proof', '--related', 'src/a.ts:0', '--body', 'x']))
      .toThrow(/1-based/);
  });

  it('keeps a Windows-style drive path intact when splitting off the line', () => {
    const p = parseNoteAdd(['--file', 'a.ts', '--lines', '1', '--kind', 'proof', '--related', 'C:/src/a.ts:42', '--body', 'x']);
    expect(p.related).toEqual([{ uri: 'C:/src/a.ts', line: 42 }]);
  });

  /**
   * An unrecognized flag used to be accepted and silently dropped — each
   * consumer read only the keys it knew. That hid ordinary typos, and it hid a
   * flag passed to a build that predates it: `--related` against the older
   * published binary reported success and wrote a note with no related
   * locations (GB-1100).
   */
  describe('unknown flags (GB-1100)', () => {
    it('rejects an unknown flag and names it', () => {
      expect(() => parseNoteAdd(['--file', 'a.ts', '--lines', '1', '--kind', 'proof', '--bogus', 'x', '--body', 'y']))
        .toThrow(/unknown flag --bogus/);
    });

    it('rejects a near-miss of a real flag rather than ignoring it', () => {
      // The plural is the plausible typo for the repeatable form.
      expect(() => parseNoteAdd(['--file', 'a.ts', '--lines', '1', '--kind', 'proof', '--artifacts', 'out.txt', '--body', 'y']))
        .toThrow(/unknown flag --artifacts/);
    });

    it('lists the accepted flags so the caller can self-correct', () => {
      expect(() => parseNoteAdd(['--file', 'a.ts', '--lines', '1', '--kind', 'proof', '--nope', 'x', '--body', 'y']))
        .toThrow(/accepted: .*--artifact.*--related/);
    });

    it('still accepts every documented add flag', () => {
      expect(() => parseNoteAdd([
        '--file', 'a.ts', '--lines', '1-2', '--kind', 'proof', '--body', 'b',
        '--confidence', '0.5', '--rank', '10', '--ticket', 'GB-1', '--producer', 'P',
        '--producer-version', '1.0', '--artifact', 'out.txt', '--related', 'src/a.ts:4',
      ])).not.toThrow();
    });

    it('names the running version, since the flag may simply postdate this build', async () => {
      await expect(runNoteCli(['add', '--file', 'a.ts', '--lines', '1', '--kind', 'proof', '--related', 'a.ts:1', '--bogus', 'x', '--body', 'y']))
        .rejects.toThrow(/This is glassbox \d+\.\d+\.\d+/);
    });

    /** Drift guard: the usage text and the accepted set are maintained in two
     *  places, so a flag documented but not accepted (or the reverse) is a real
     *  possibility. Probed through the public surface rather than by exporting
     *  the internal table. */
    it('accepts exactly the add flags its usage text documents', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await runNoteCli([]);
      const usage = log.mock.calls.map(c => String(c[0])).join('\n');
      log.mockRestore();

      const addSection = usage.slice(usage.indexOf('add — required:'), usage.indexOf('update/remove use'));
      const documented = [...new Set([...addSection.matchAll(/--([a-z-]+)/g)].map(m => m[1]))];
      expect(documented.length).toBeGreaterThan(5);

      for (const flag of documented) {
        expect(() => parseNoteAdd(['--file', 'a.ts', '--lines', '1', '--kind', 'proof', '--body', 'b', `--${flag}`, 'v']))
          .not.toThrow(/unknown flag/);
      }
    });

    it('scopes the accepted set per subcommand', async () => {
      // `--related` is an `add` flag; `update` has no such patch field, so
      // accepting it there would silently do nothing.
      await expect(runNoteCli(['update', '--id', 'g', '--related', 'a.ts:1']))
        .rejects.toThrow(/unknown flag --related for 'glassbox note update'/);
      await expect(runNoteCli(['coalesce', '--id', 'g'])).rejects.toThrow(/unknown flag --id/);
      await expect(runNoteCli(['remove', '--kind', 'proof'])).rejects.toThrow(/unknown flag --kind/);
    });
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

  it('instructions prints the inbound contract', async () => {
    await runNoteCli(['instructions'], { cwd: repo });
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringContaining('Emitting AI review notes'));
  });

  it('update edits a note by guid', async () => {
    const { guid } = writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: 'old', kind: 'rationale' });
    await runNoteCli(['update', '--id', guid, '--body', 'new', '--kind', 'risk'], { cwd: repo });
    const r = JSON.parse(readFileSync(join(repo, '.pr-notes/notes/src/x.ts.000000.sarif'), 'utf-8')) as { runs: { results: { message: { text: string } }[] }[] };
    expect(r.runs[0].results[0].message.text).toBe('new');
  });

  it('remove deletes a note by guid', async () => {
    const { guid } = writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: 'gone', kind: 'rationale' });
    await runNoteCli(['remove', '--id', guid], { cwd: repo });
    expect(existsSync(join(repo, '.pr-notes/notes/src/x.ts.000000.sarif'))).toBe(false);
  });

  it('update/remove error on an unknown id', async () => {
    await expect(runNoteCli(['update', '--id', 'nope', '--body', 'x'], { cwd: repo })).rejects.toThrow(/no review note found/);
    await expect(runNoteCli(['remove', '--id', 'nope'], { cwd: repo })).rejects.toThrow(/no review note found/);
  });

  it('coalesce removes redundant notes', async () => {
    writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: 'dup', kind: 'rationale' });
    writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: 'dup', kind: 'rationale' });
    await runNoteCli(['coalesce', '--file', 'src/x.ts'], { cwd: repo });
    const r = JSON.parse(readFileSync(join(repo, '.pr-notes/notes/src/x.ts.000000.sarif'), 'utf-8')) as { runs: { results: unknown[] }[] };
    expect(r.runs[0].results).toHaveLength(1);
  });
});
