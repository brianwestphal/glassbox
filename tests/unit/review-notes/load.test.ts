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

  it('reads a text artifact\'s content for inline display (GB-898)', () => {
    mkdirSync(join(repo, '.pr-notes/artifacts'), { recursive: true });
    writeFileSync(join(repo, '.pr-notes/artifacts/out.txt'), 'PASS 2 tests', 'utf-8');
    writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: 'proof', kind: 'proof', artifacts: ['.pr-notes/artifacts/out.txt'] });

    const note = loadReviewNotesForFile(repo, 'src/x.ts')[0];
    expect(note.artifacts).toEqual([{ uri: '.pr-notes/artifacts/out.txt', content: 'PASS 2 tests' }]);
  });

  it('surfaces a missing or binary artifact as a reference with no content (GB-898)', () => {
    writeFileSync(join(repo, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02]));
    writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: 'b', kind: 'proof', artifacts: ['binary.bin', 'does-not-exist.txt'] });

    const note = loadReviewNotesForFile(repo, 'src/x.ts')[0];
    expect(note.artifacts).toEqual([
      { uri: 'binary.bin', content: undefined },
      { uri: 'does-not-exist.txt', content: undefined },
    ]);
  });

  it('marks image artifacts so they render as <img> rather than text (GB-911)', () => {
    writeFileSync(join(repo, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: 'see', kind: 'proof', artifacts: ['shot.png'] });
    const note = loadReviewNotesForFile(repo, 'src/x.ts')[0];
    expect(note.artifacts).toEqual([{ uri: 'shot.png', isImage: true }]);
  });

  it('never reads an artifact path that escapes the repo (GB-898)', () => {
    writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: 'b', kind: 'proof', artifacts: ['../../../etc/passwd'] });
    const note = loadReviewNotesForFile(repo, 'src/x.ts')[0];
    expect(note.artifacts![0].content).toBeUndefined();
  });

  /**
   * A third-party producer following SARIF 2.1.0 §3.11.9 writes the formatted
   * body in `message.markdown` and a plain-text rendering in `message.text`
   * (which is mandatory whenever `markdown` is present). Glassbox renders
   * markdown, so it must display the `markdown` form — reading `text` would
   * silently discard the formatting.
   */
  describe('message.text / message.markdown precedence (GB-1093)', () => {
    /** Hand-authored shard, as a foreign producer would emit it. */
    function writeForeignShard(message: Record<string, string>): void {
      mkdirSync(join(repo, '.pr-notes/notes/src'), { recursive: true });
      writeFileSync(join(repo, '.pr-notes/notes/src/x.ts.000000.sarif'), JSON.stringify({
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'Other Tool' } },
          results: [{
            message,
            locations: [{ physicalLocation: { artifactLocation: { uri: 'src/x.ts' }, region: { startLine: 1, endLine: 1 } } }],
            properties: { tags: ['proof'] },
          }],
        }],
      }), 'utf-8');
    }

    it('prefers markdown over the plain-text fallback', () => {
      writeForeignShard({ text: 'Root cause: the guard was missing.', markdown: '### Root cause\n\n- the guard was missing' });
      expect(loadReviewNotesForFile(repo, 'src/x.ts')[0].body).toBe('### Root cause\n\n- the guard was missing');
    });

    it('falls back to text when only text is present', () => {
      writeForeignShard({ text: 'plain only' });
      expect(loadReviewNotesForFile(repo, 'src/x.ts')[0].body).toBe('plain only');
    });

    it('yields an empty body when neither form is present', () => {
      writeForeignShard({});
      expect(loadReviewNotesForFile(repo, 'src/x.ts')[0].body).toBe('');
    });
  });

  /** SARIF §3.11.6 embedded links — the body references these by index
   *  (GB-1097), so the array's order and length must survive the round-trip. */
  describe('relatedLocations', () => {
    it('round-trips related locations in order', () => {
      writeReviewNote(repo, {
        file: 'src/x.ts', startLine: 1, endLine: 1, body: 'see [it](1)', kind: 'rationale',
        related: [{ uri: 'src/a.ts', line: 5 }, { uri: 'src/b.ts', line: 9 }],
      });
      expect(loadReviewNotesForFile(repo, 'src/x.ts')[0].related).toEqual([
        { uri: 'src/a.ts', line: 5 },
        { uri: 'src/b.ts', line: 9 },
      ]);
    });

    it('is undefined when a note declares none', () => {
      writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: 'plain', kind: 'rationale' });
      expect(loadReviewNotesForFile(repo, 'src/x.ts')[0].related).toBeUndefined();
    });

    it('keeps an unusable entry as a placeholder so later indices still line up', () => {
      mkdirSync(join(repo, '.pr-notes/notes/src'), { recursive: true });
      writeFileSync(join(repo, '.pr-notes/notes/src/x.ts.000000.sarif'), JSON.stringify({
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'Other Tool' } },
          results: [{
            message: { text: 'see [it](1)' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'src/x.ts' }, region: { startLine: 1 } } }],
            properties: { tags: ['rationale'] },
            relatedLocations: [
              { physicalLocation: { artifactLocation: {} } },
              { physicalLocation: { artifactLocation: { uri: 'src/b.ts' }, region: { startLine: 9 } } },
            ],
          }],
        }],
      }), 'utf-8');

      expect(loadReviewNotesForFile(repo, 'src/x.ts')[0].related).toEqual([
        { uri: '', line: 0 },
        { uri: 'src/b.ts', line: 9 },
      ]);
    });
  });

  it('skips a corrupt shard rather than throwing', () => {
    writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: 'good', kind: 'rationale' });
    // Drop a non-SARIF shard alongside the good one.
    writeFileSync(join(repo, '.pr-notes/notes/src/x.ts.000001.sarif'), 'not json at all', 'utf-8');
    const notes = loadReviewNotesForFile(repo, 'src/x.ts');
    expect(notes.map(n => n.body)).toEqual(['good']);
  });
});
