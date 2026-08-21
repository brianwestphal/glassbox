/**
 * GB-895 (P1) — the `.pr-notes/` sharded store: path-mirrored layout, the
 * per-shard record cap + roll-over, run-per-producer grouping, and lossless
 * read-modify-write.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { coalesceAll, coalesceFile, listFilesWithNotes, loadReviewNotesForFile, noteSourceForShardPath, removeNote, updateNote, writeReviewNote } from '../../../src/review-notes/store.js';
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

/**
 * SARIF §3.11.9 requires `text` beside `markdown` so the message stays readable
 * in a viewer that can't render formatting. The two fields must therefore differ
 * for a formatted body — writing the source into both defeats the purpose
 * (GB-1096).
 */
describe('message.text / message.markdown (GB-1096)', () => {
  const BODY = '### Root cause\n\nThe guard was **missing**.';

  function messageOf(rel = '.pr-notes/notes/src/x.ts.000000.sarif'): { text: string; markdown: string } {
    const result = readShard(rel).runs[0].results[0] as { message: { text: string; markdown: string } };
    return result.message;
  }

  it('writes the markdown source verbatim and a flattened plain-text fallback', () => {
    writeReviewNote(repo, note({ body: BODY }));
    const message = messageOf();
    expect(message.markdown).toBe(BODY);
    expect(message.text).toBe('Root cause\n\nThe guard was missing.');
  });

  it('keeps both fields in step when a note is updated', () => {
    const { guid } = writeReviewNote(repo, note({ body: 'plain' }));
    expect(updateNote(repo, guid, { body: BODY })).toBe(true);
    const message = messageOf();
    expect(message.markdown).toBe(BODY);
    expect(message.text).toBe('Root cause\n\nThe guard was missing.');
  });

  it('falls back to the source rather than writing an empty text', () => {
    // A body of only fence markers flattens to nothing; `text` must stay
    // non-empty when present.
    writeReviewNote(repo, note({ body: '```' }));
    expect(messageOf().text).toBe('```');
  });

  it('round-trips the displayed body unchanged through the reader', () => {
    writeReviewNote(repo, note({ body: BODY }));
    expect(loadReviewNotesForFile(repo, 'src/x.ts')[0].body).toBe(BODY);
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

describe('removeNote (GB-902)', () => {
  it('removes a note by guid, scoped to its file', () => {
    const { guid } = writeReviewNote(repo, note());
    writeReviewNote(repo, note({ body: 'keep me' }));
    expect(removeNote(repo, guid, 'src/x.ts')).toBe(true);
    const log = readShard('.pr-notes/notes/src/x.ts.000000.sarif');
    expect(log.runs[0].results).toHaveLength(1);
    expect((log.runs[0].results[0] as { guid: string }).guid).not.toBe(guid);
  });

  it('finds a note by guid without --file (global walk) and deletes an emptied shard', () => {
    const { guid } = writeReviewNote(repo, note());
    expect(removeNote(repo, guid)).toBe(true);
    expect(existsSync(join(repo, '.pr-notes/notes/src/x.ts.000000.sarif'))).toBe(false);
  });

  it('returns false for an unknown guid', () => {
    writeReviewNote(repo, note());
    expect(removeNote(repo, 'nope', 'src/x.ts')).toBe(false);
  });
});

describe('updateNote (GB-902)', () => {
  it('patches body, kind, confidence, and ticket in place', () => {
    const { guid } = writeReviewNote(repo, note());
    expect(updateNote(repo, guid, { body: 'revised', kind: 'risk', confidence: 0.5, ticket: 'GB-902' })).toBe(true);
    const r = readShard('.pr-notes/notes/src/x.ts.000000.sarif').runs[0].results[0] as {
      message: { text: string; markdown: string }; level: string; properties: Record<string, unknown>; workItemUris: string[];
    };
    expect(r.message.markdown).toBe('revised');
    expect(r.level).toBe('warning');
    expect(r.properties.tags).toEqual(['risk']);
    expect(r.properties['ext-ai-tool-confidence']).toBe(0.5);
    expect(r.workItemUris).toEqual(['GB-902']);
  });

  it('returns false for an unknown guid', () => {
    expect(updateNote(repo, 'nope', { body: 'x' })).toBe(false);
  });
});

describe('coalesce (GB-902)', () => {
  it('drops redundant notes (same anchor+kind+body), keeping the most recent', () => {
    writeReviewNote(repo, note({ body: 'dup' }));
    writeReviewNote(repo, note({ body: 'unique' }));
    const { guid: lastDup } = writeReviewNote(repo, note({ body: 'dup' }));
    expect(coalesceFile(repo, 'src/x.ts')).toBe(1);
    const results = readShard('.pr-notes/notes/src/x.ts.000000.sarif').runs[0].results as { guid: string; message: { text: string } }[];
    expect(results).toHaveLength(2);
    // The surviving 'dup' is the most recently written one.
    expect(results.find(r => r.message.text === 'dup')!.guid).toBe(lastDup);
  });

  /** Dedup must compare the body actually displayed — `markdown` when present
   *  (GB-1093) — or two notes whose plain-text fallbacks happen to match would
   *  collapse into one despite rendering differently. */
  it('keeps notes whose markdown differs even when the plain-text fallback matches', () => {
    mkdirSync(join(repo, '.pr-notes/notes/src'), { recursive: true });
    const location = { physicalLocation: { artifactLocation: { uri: 'src/x.ts' }, region: { startLine: 1, endLine: 2 } } };
    writeFileSync(join(repo, '.pr-notes/notes/src/x.ts.000000.sarif'), JSON.stringify({
      version: '2.1.0',
      runs: [{
        tool: { driver: { name: 'Other Tool' } },
        results: [
          { guid: 'a', message: { text: 'same plain text', markdown: '**bold** version' }, locations: [location], properties: { tags: ['rationale'] } },
          { guid: 'b', message: { text: 'same plain text', markdown: '- list version' }, locations: [location], properties: { tags: ['rationale'] } },
        ],
      }],
    }), 'utf-8');

    expect(coalesceFile(repo, 'src/x.ts')).toBe(0);
    expect(readShard('.pr-notes/notes/src/x.ts.000000.sarif').runs[0].results).toHaveLength(2);
  });

  it('coalesceAll walks every file and is a no-op when nothing is redundant', () => {
    writeReviewNote(repo, note({ body: 'a' }));
    writeReviewNote(repo, note({ file: 'src/y.ts', body: 'b' }));
    expect(coalesceAll(repo)).toBe(0);
  });
});

describe('artifacts (GB-898 / GB-911)', () => {
  it('records a sha-256 hash of each attached artifact (GB-911)', () => {
    writeFileSync(join(repo, 'out.txt'), 'hello world', 'utf-8');
    writeReviewNote(repo, note({ body: 'proof', kind: 'proof', artifacts: ['out.txt'] }));
    const result = readShard('.pr-notes/notes/src/x.ts.000000.sarif').runs[0].results[0] as {
      attachments: { artifactLocation: { uri: string; properties?: Record<string, string> } }[];
    };
    const expected = createHash('sha256').update('hello world').digest('hex');
    expect(result.attachments[0].artifactLocation.uri).toBe('out.txt');
    expect(result.attachments[0].artifactLocation.properties!['ext-sha256']).toBe(expected);
  });

  it('adds the Git LFS filter when a binary image artifact is attached (GB-911)', () => {
    writeFileSync(join(repo, 'shot.png'), Buffer.from([0x89, 0x50]));
    writeReviewNote(repo, note({ artifacts: ['shot.png'] }));
    expect(readFileSync(join(repo, '.gitattributes'), 'utf-8')).toContain('.pr-notes/artifacts/** filter=lfs');
  });

  it('does not add the LFS filter for a text-only artifact (GB-911)', () => {
    writeFileSync(join(repo, 'out.txt'), 'x', 'utf-8');
    writeReviewNote(repo, note({ artifacts: ['out.txt'] }));
    expect(existsSync(join(repo, '.gitattributes'))).toBe(false);
  });
});

describe('listFilesWithNotes (GB-1136/GB-1137)', () => {
  it('returns [] when the repo has no notes tree', () => {
    expect(listFilesWithNotes(repo)).toEqual([]);
  });

  it('lists each source path that has notes, sorted and de-duplicated across shards', () => {
    mkdirSync(join(repo, 'src/a'), { recursive: true });
    writeFileSync(join(repo, 'src/a/b.ts'), 'x\ny\n', 'utf-8');
    // Two notes on the same file (same-anchor de-dup isn't the point; both write
    // to that file's shard) plus a note on a second file.
    writeReviewNote(repo, note({ file: 'src/a/b.ts', startLine: 1, endLine: 1 }));
    writeReviewNote(repo, note({ file: 'src/a/b.ts', startLine: 2, endLine: 2 }));
    writeReviewNote(repo, note({ file: 'src/x.ts', startLine: 1, endLine: 1 }));
    expect(listFilesWithNotes(repo)).toEqual(['src/a/b.ts', 'src/x.ts']);
  });
});

describe('noteSourceForShardPath (GB-1137)', () => {
  it('maps a note shard path back to its source path', () => {
    expect(noteSourceForShardPath('.pr-notes/notes/src/foo.ts.000000.sarif')).toBe('src/foo.ts');
    expect(noteSourceForShardPath('.pr-notes/notes/a/b/c.tsx.000012.sarif')).toBe('a/b/c.tsx');
  });

  it('normalizes backslash paths (Windows diff paths)', () => {
    expect(noteSourceForShardPath('.pr-notes\\notes\\src\\foo.ts.000000.sarif')).toBe('src/foo.ts');
  });

  it('returns null for a non-shard path', () => {
    expect(noteSourceForShardPath('src/foo.ts')).toBeNull();
    expect(noteSourceForShardPath('.pr-notes/artifacts/x.png')).toBeNull();
    expect(noteSourceForShardPath('.pr-notes/notes/src/foo.ts')).toBeNull(); // no shard suffix
  });
});
