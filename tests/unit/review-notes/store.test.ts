/**
 * GB-895 (P1) — the `.pr-notes/` sharded store: path-mirrored layout, the
 * per-shard record cap + roll-over, run-per-producer grouping, and lossless
 * read-modify-write.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeReviewNote } from '../../../src/review-notes/store.js';
import type { ReviewNoteInput } from '../../../src/review-notes/types.js';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'glassbox-prnotes-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src/x.ts'), 'line1\nline2\nline3\nline4\n', 'utf-8');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function note(overrides: Partial<ReviewNoteInput> = {}): ReviewNoteInput {
  return { file: 'src/x.ts', startLine: 1, endLine: 2, body: 'why', kind: 'rationale', producer: 'Claude Code', ...overrides };
}

function readShard(rel: string): { runs: { results: unknown[] }[] } {
  return JSON.parse(readFileSync(join(repo, rel), 'utf-8')) as { runs: { results: unknown[] }[] };
}

describe('writeReviewNote — layout', () => {
  it('writes to a path-mirrored .000000.sarif shard', () => {
    const { path } = writeReviewNote(repo, note());
    expect(path).toBe(join(repo, '.pr-notes/notes/src/x.ts.000000.sarif'));
    expect(existsSync(path)).toBe(true);
    expect(readShard('.pr-notes/notes/src/x.ts.000000.sarif').runs[0].results).toHaveLength(1);
  });

  it('records the anchored snippet read from the working tree', () => {
    writeReviewNote(repo, note({ startLine: 2, endLine: 3 }));
    const log = readShard('.pr-notes/notes/src/x.ts.000000.sarif');
    const result = log.runs[0].results[0] as { locations: { physicalLocation: { region: { snippet: { text: string } } } }[] };
    expect(result.locations[0].physicalLocation.region.snippet.text).toBe('line2\nline3');
  });

  it('appends a second note for the same file into the same shard', () => {
    writeReviewNote(repo, note());
    writeReviewNote(repo, note({ body: 'second' }));
    const log = readShard('.pr-notes/notes/src/x.ts.000000.sarif');
    expect(log.runs[0].results).toHaveLength(2);
  });
});

describe('writeReviewNote — sharding', () => {
  it('rolls to the next shard index when the cap is reached', () => {
    writeReviewNote(repo, note(), { cap: 1 });
    const { path } = writeReviewNote(repo, note({ body: 'overflow' }), { cap: 1 });
    expect(path).toBe(join(repo, '.pr-notes/notes/src/x.ts.000001.sarif'));
    expect(readShard('.pr-notes/notes/src/x.ts.000000.sarif').runs[0].results).toHaveLength(1);
    expect(readShard('.pr-notes/notes/src/x.ts.000001.sarif').runs[0].results).toHaveLength(1);
  });
});

describe('writeReviewNote — run grouping & round-trip', () => {
  it('groups results into separate runs per producer', () => {
    writeReviewNote(repo, note({ producer: 'Claude Code' }));
    writeReviewNote(repo, note({ producer: 'Hot Sheet' }));
    const log = readShard('.pr-notes/notes/src/x.ts.000000.sarif');
    expect(log.runs).toHaveLength(2);
    const names = (log.runs as { tool: { driver: { name: string } } }[]).map(r => r.tool.driver.name).sort();
    expect(names).toEqual(['Claude Code', 'Hot Sheet']);
  });

  it('preserves unknown fields written by another tool on round-trip', () => {
    const { path } = writeReviewNote(repo, note());
    // Simulate another producer having added a top-level field.
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    raw.customTopLevel = { keep: true };
    writeFileSync(path, JSON.stringify(raw), 'utf-8');
    writeReviewNote(repo, note({ body: 'again' }));
    const after = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    expect(after.customTopLevel).toEqual({ keep: true });
    expect((after.runs as { results: unknown[] }[])[0].results).toHaveLength(2);
  });

  it('refuses to overwrite a shard that is not a SARIF log', () => {
    const dir = join(repo, '.pr-notes/notes/src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'x.ts.000000.sarif'), '{"not":"sarif"}', 'utf-8');
    expect(() => writeReviewNote(repo, note())).toThrow(/refusing to overwrite/);
  });
});
