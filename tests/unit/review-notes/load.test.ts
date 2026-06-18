/**
 * GB-896 (P2) — the `.pr-notes/` reader: flattening SARIF shards into
 * diff-anchored view items, and resilience to a corrupt shard.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadReviewNotesForFile, writeReviewNote } from '../../../src/review-notes/store.js';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'glassbox-loadnotes-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src/x.ts'), 'a\nb\nc\nd\ne\nf\n', 'utf-8');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('loadReviewNotesForFile', () => {
  it('returns [] when a file has no notes', () => {
    expect(loadReviewNotesForFile(repo, 'src/x.ts')).toEqual([]);
  });

  it('flattens notes to diff-anchored view items on the new side', () => {
    writeReviewNote(repo, { file: 'src/x.ts', startLine: 5, endLine: 6, body: 'why', kind: 'rationale', confidence: 0.8, producer: 'Claude Code' });
    writeReviewNote(repo, { file: 'src/x.ts', startLine: 2, endLine: 2, body: 'risky', kind: 'risk' });

    const notes = loadReviewNotesForFile(repo, 'src/x.ts');
    expect(notes).toHaveLength(2);
    // snippet is the authored text (file lines 5–6), kept for P3 re-anchoring;
    // guid is a generated id (threading anchor), so match the rest.
    expect(notes).toContainEqual(expect.objectContaining({ line: 5, side: 'new', kind: 'rationale', body: 'why', confidence: 0.8, producer: 'Claude Code', snippet: 'e\nf' }));
    expect(notes.find(n => n.kind === 'rationale')!.guid).toEqual(expect.any(String));
    // No producer / confidence supplied → default producer, undefined confidence.
    const risk = notes.find(n => n.kind === 'risk')!;
    expect(risk.line).toBe(2);
    expect(risk.confidence).toBeUndefined();
  });

  it('only returns the requested file\'s notes', () => {
    writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: 'x', kind: 'rationale' });
    writeFileSync(join(repo, 'src/y.ts'), 'a\n', 'utf-8');
    writeReviewNote(repo, { file: 'src/y.ts', startLine: 1, endLine: 1, body: 'y', kind: 'proof' });
    expect(loadReviewNotesForFile(repo, 'src/y.ts').map(n => n.body)).toEqual(['y']);
  });

  it('skips a corrupt shard rather than throwing', () => {
    writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: 'good', kind: 'rationale' });
    // Drop a non-SARIF shard alongside the good one.
    writeFileSync(join(repo, '.pr-notes/notes/src/x.ts.000001.sarif'), 'not json at all', 'utf-8');
    const notes = loadReviewNotesForFile(repo, 'src/x.ts');
    expect(notes.map(n => n.body)).toEqual(['good']);
  });
});
