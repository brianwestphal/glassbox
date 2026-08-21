/**
 * GB-1137 — files surfaced in a review only because they carry AI review notes,
 * shown as `unchanged` so the notes stay reachable.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeReviewNote } from '../../../src/review-notes/store.js';
import type { ReviewNoteInput } from '../../../src/review-notes/types.js';
import { collectNoteOnlyFiles } from '../../../src/review-notes/unchanged-files.js';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'glassbox-noteonly-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src/a.ts'), 'a1\na2\n', 'utf-8');
  writeFileSync(join(repo, 'src/b.ts'), 'b1\nb2\nb3\n', 'utf-8');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function note(overrides: Partial<ReviewNoteInput> = {}): ReviewNoteInput {
  return { file: 'src/a.ts', startLine: 1, endLine: 1, body: 'why', kind: 'rationale', producer: 'Claude Code', ...overrides };
}

describe('collectNoteOnlyFiles', () => {
  it('returns [] when nothing has notes', () => {
    expect(collectNoteOnlyFiles(repo, new Set())).toEqual([]);
  });

  it('surfaces note-bearing files not in the diff, as unchanged all-context diffs', () => {
    writeReviewNote(repo, note({ file: 'src/a.ts' }));
    writeReviewNote(repo, note({ file: 'src/b.ts' }));

    // src/a.ts is already a changed file, so only src/b.ts is surfaced.
    const result = collectNoteOnlyFiles(repo, new Set(['src/a.ts']));
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('src/b.ts');
    expect(result[0].diff.status).toBe('unchanged');
    expect(result[0].diff.hunks[0].lines.map(l => l.content)).toEqual(['b1', 'b2', 'b3']);
  });

  it('skips a note whose source file no longer exists', () => {
    writeReviewNote(repo, note({ file: 'src/gone.ts', startLine: 1, endLine: 1 }));
    expect(collectNoteOnlyFiles(repo, new Set())).toEqual([]);
  });

  it('never re-surfaces the .pr-notes note store itself', () => {
    writeReviewNote(repo, note({ file: 'src/b.ts' }));
    // A (contrived) note anchored under .pr-notes must not loop back into the list.
    mkdirSync(join(repo, '.pr-notes/x'), { recursive: true });
    writeFileSync(join(repo, '.pr-notes/x/y.ts'), 'z\n', 'utf-8');
    writeReviewNote(repo, note({ file: '.pr-notes/x/y.ts', startLine: 1, endLine: 1 }));
    const paths = collectNoteOnlyFiles(repo, new Set()).map(r => r.filePath);
    expect(paths).toContain('src/b.ts');
    expect(paths.some(p => p.startsWith('.pr-notes/'))).toBe(false);
  });
});
