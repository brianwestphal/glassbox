/**
 * GB-1137 — files whose AI review notes are part of THIS review's change set
 * (a note shard in the diff) but whose own source wasn't changed are surfaced
 * as `unchanged`, so those notes stay reachable. Scoped to the review's diff,
 * NOT every file that ever had a note on disk.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FileDiff } from '../../../src/git/types.js';
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

/** A minimal FileDiff for a changed path (content irrelevant to the scoping). */
function diff(filePath: string, status: FileDiff['status'] = 'modified'): FileDiff {
  return { filePath, oldPath: null, status, hunks: [], isBinary: false };
}

/** The note shard path for a source file (the store's on-disk layout). */
function shard(src: string): string {
  return `.pr-notes/notes/${src}.000000.sarif`;
}

describe('collectNoteOnlyFiles', () => {
  it('returns [] when the diff has no note shards', () => {
    expect(collectNoteOnlyFiles(repo, [diff('src/a.ts')])).toEqual([]);
  });

  it('surfaces a file whose note shard is in the diff but whose source is unchanged', () => {
    // The review changed src/a.ts and added a note about src/b.ts (b unchanged).
    const diffs = [diff('src/a.ts'), diff(shard('src/b.ts'), 'added')];
    const result = collectNoteOnlyFiles(repo, diffs);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('src/b.ts');
    expect(result[0].diff.status).toBe('unchanged');
    expect(result[0].diff.hunks[0].lines.map(l => l.content)).toEqual(['b1', 'b2', 'b3']);
  });

  it('does NOT surface a note-bearing file whose note shard is NOT in this diff', () => {
    // src/b.ts has a note on disk, but the review's diff doesn't touch that shard.
    writeFileSync(join(repo, '.gitkeep'), '', 'utf-8');
    expect(collectNoteOnlyFiles(repo, [diff('src/a.ts')])).toEqual([]);
  });

  it('does not re-surface a source that is itself a changed file', () => {
    const diffs = [diff('src/a.ts'), diff(shard('src/a.ts'), 'modified')];
    expect(collectNoteOnlyFiles(repo, diffs)).toEqual([]);
  });

  it('skips a note shard that was deleted (the note is gone)', () => {
    const diffs = [diff(shard('src/b.ts'), 'deleted')];
    expect(collectNoteOnlyFiles(repo, diffs)).toEqual([]);
  });

  it('skips a note shard whose source file no longer exists', () => {
    const diffs = [diff(shard('src/gone.ts'), 'added')];
    expect(collectNoteOnlyFiles(repo, diffs)).toEqual([]);
  });
});
