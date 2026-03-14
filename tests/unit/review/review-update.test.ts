import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileDiff, DiffLine } from '../../../src/git/diff.js';

// Mock the database module before importing the module under test
vi.mock('../../../src/db/queries.js', () => ({
  getReviewFiles: vi.fn(),
  getAnnotationsForFile: vi.fn(),
  updateFileDiff: vi.fn(),
  addReviewFile: vi.fn(),
  deleteReviewFile: vi.fn(),
  moveAnnotation: vi.fn(),
  markAnnotationStale: vi.fn(),
  markAnnotationCurrent: vi.fn(),
  updateReviewHead: vi.fn(),
}));

import { updateReviewDiffs } from '../../../src/review-update.js';
import {
  getReviewFiles,
  getAnnotationsForFile,
  updateFileDiff,
  addReviewFile,
  deleteReviewFile,
  moveAnnotation,
  markAnnotationStale,
  markAnnotationCurrent,
  updateReviewHead,
} from '../../../src/db/queries.js';
import type { Annotation, ReviewFile } from '../../../src/db/queries.js';

// --- Helpers ---

function makeDiff(
  filePath: string,
  lines: Array<{ type: DiffLine['type']; oldNum: number | null; newNum: number | null; content: string }>,
): FileDiff {
  return {
    filePath,
    oldPath: null,
    status: 'modified',
    hunks: [{
      oldStart: 1,
      oldCount: lines.filter(l => l.type !== 'add').length,
      newStart: 1,
      newCount: lines.filter(l => l.type !== 'remove').length,
      lines: lines.map(l => ({ type: l.type, oldNum: l.oldNum, newNum: l.newNum, content: l.content })),
    }],
    isBinary: false,
  };
}

function makeReviewFile(id: string, filePath: string, diff: FileDiff): ReviewFile {
  return {
    id,
    review_id: 'rev1',
    file_path: filePath,
    status: 'pending',
    diff_data: JSON.stringify(diff),
    created_at: '2026-01-01T00:00:00Z',
  };
}

function makeAnnotation(overrides: Partial<Annotation> & { id: string; line_number: number; side: string }): Annotation {
  return {
    review_file_id: 'file1',
    category: 'note',
    content: 'test annotation',
    is_stale: false,
    original_content: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('updateReviewDiffs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all write mocks resolve successfully
    vi.mocked(updateFileDiff).mockResolvedValue(undefined);
    vi.mocked(addReviewFile).mockResolvedValue({} as ReviewFile);
    vi.mocked(deleteReviewFile).mockResolvedValue(undefined);
    vi.mocked(moveAnnotation).mockResolvedValue(undefined);
    vi.mocked(markAnnotationStale).mockResolvedValue(undefined);
    vi.mocked(markAnnotationCurrent).mockResolvedValue(undefined);
    vi.mocked(updateReviewHead).mockResolvedValue(undefined);
  });

  it('adds new files when no existing files', async () => {
    vi.mocked(getReviewFiles).mockResolvedValue([]);

    const diff1 = makeDiff('src/a.ts', [
      { type: 'add', oldNum: null, newNum: 1, content: 'const a = 1;' },
    ]);
    const diff2 = makeDiff('src/b.ts', [
      { type: 'add', oldNum: null, newNum: 1, content: 'const b = 2;' },
    ]);

    const result = await updateReviewDiffs('rev1', [diff1, diff2], 'abc123');

    expect(result).toEqual({ updated: 0, added: 2, stale: 0 });
    expect(addReviewFile).toHaveBeenCalledTimes(2);
    expect(addReviewFile).toHaveBeenCalledWith('rev1', 'src/a.ts', JSON.stringify(diff1));
    expect(addReviewFile).toHaveBeenCalledWith('rev1', 'src/b.ts', JSON.stringify(diff2));
    expect(updateFileDiff).not.toHaveBeenCalled();
    expect(deleteReviewFile).not.toHaveBeenCalled();
  });

  it('updates existing file with new diff when there are no annotations', async () => {
    const oldDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 1, newNum: 1, content: 'old line' },
    ]);
    vi.mocked(getReviewFiles).mockResolvedValue([makeReviewFile('file1', 'foo.ts', oldDiff)]);
    vi.mocked(getAnnotationsForFile).mockResolvedValue([]);

    const newDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 1, newNum: 1, content: 'new line' },
    ]);

    const result = await updateReviewDiffs('rev1', [newDiff], 'def456');

    expect(result).toEqual({ updated: 1, added: 0, stale: 0 });
    expect(updateFileDiff).toHaveBeenCalledWith('file1', JSON.stringify(newDiff));
    expect(moveAnnotation).not.toHaveBeenCalled();
    expect(markAnnotationStale).not.toHaveBeenCalled();
  });

  it('leaves annotation in place when content stays at same position', async () => {
    const oldDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 3, newNum: 3, content: 'line 3' },
      { type: 'context', oldNum: 4, newNum: 4, content: 'line 4' },
      { type: 'context', oldNum: 5, newNum: 5, content: 'hello' },
      { type: 'context', oldNum: 6, newNum: 6, content: 'line 6' },
    ]);
    vi.mocked(getReviewFiles).mockResolvedValue([makeReviewFile('file1', 'foo.ts', oldDiff)]);

    const annotation = makeAnnotation({ id: 'ann1', line_number: 5, side: 'new' });
    vi.mocked(getAnnotationsForFile).mockResolvedValue([annotation]);

    const newDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 3, newNum: 3, content: 'line 3' },
      { type: 'context', oldNum: 4, newNum: 4, content: 'line 4' },
      { type: 'context', oldNum: 5, newNum: 5, content: 'hello' },
      { type: 'context', oldNum: 6, newNum: 6, content: 'line 6' },
    ]);

    const result = await updateReviewDiffs('rev1', [newDiff], 'abc');

    expect(result).toEqual({ updated: 1, added: 0, stale: 0 });
    expect(moveAnnotation).not.toHaveBeenCalled();
    expect(markAnnotationStale).not.toHaveBeenCalled();
    expect(markAnnotationCurrent).not.toHaveBeenCalled();
  });

  it('migrates annotation to new line when content shifts', async () => {
    const oldDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 5, newNum: 5, content: 'hello' },
    ]);
    vi.mocked(getReviewFiles).mockResolvedValue([makeReviewFile('file1', 'foo.ts', oldDiff)]);

    const annotation = makeAnnotation({ id: 'ann1', line_number: 5, side: 'new' });
    vi.mocked(getAnnotationsForFile).mockResolvedValue([annotation]);

    // In the new diff, "hello" is now at newNum 7
    const newDiff = makeDiff('foo.ts', [
      { type: 'add', oldNum: null, newNum: 5, content: 'inserted1' },
      { type: 'add', oldNum: null, newNum: 6, content: 'inserted2' },
      { type: 'context', oldNum: 5, newNum: 7, content: 'hello' },
    ]);

    const result = await updateReviewDiffs('rev1', [newDiff], 'abc');

    expect(result).toEqual({ updated: 1, added: 0, stale: 0 });
    expect(moveAnnotation).toHaveBeenCalledWith('ann1', 7, 'new');
  });

  it('marks annotation stale when content disappears from new diff', async () => {
    const oldDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 5, newNum: 5, content: 'hello' },
    ]);
    vi.mocked(getReviewFiles).mockResolvedValue([makeReviewFile('file1', 'foo.ts', oldDiff)]);

    const annotation = makeAnnotation({ id: 'ann1', line_number: 5, side: 'new' });
    vi.mocked(getAnnotationsForFile).mockResolvedValue([annotation]);

    // New diff does not contain "hello" at all
    const newDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 5, newNum: 5, content: 'goodbye' },
    ]);

    const result = await updateReviewDiffs('rev1', [newDiff], 'abc');

    expect(result).toEqual({ updated: 1, added: 0, stale: 1 });
    expect(markAnnotationStale).toHaveBeenCalledWith('ann1', 'hello');
  });

  it('marks annotations stale when file is removed from diff', async () => {
    const oldDiff = makeDiff('removed.ts', [
      { type: 'context', oldNum: 1, newNum: 1, content: 'line 1' },
      { type: 'context', oldNum: 2, newNum: 2, content: 'line 2' },
    ]);
    vi.mocked(getReviewFiles).mockResolvedValue([makeReviewFile('file1', 'removed.ts', oldDiff)]);

    const ann1 = makeAnnotation({ id: 'ann1', line_number: 1, side: 'new' });
    const ann2 = makeAnnotation({ id: 'ann2', line_number: 2, side: 'new' });
    vi.mocked(getAnnotationsForFile).mockResolvedValue([ann1, ann2]);

    // No diffs at all — the file is gone
    const result = await updateReviewDiffs('rev1', [], 'abc');

    expect(result).toEqual({ updated: 0, added: 0, stale: 2 });
    expect(markAnnotationStale).toHaveBeenCalledTimes(2);
    expect(markAnnotationStale).toHaveBeenCalledWith('ann1', 'line 1');
    expect(markAnnotationStale).toHaveBeenCalledWith('ann2', 'line 2');
    expect(deleteReviewFile).not.toHaveBeenCalled();
  });

  it('deletes file when removed from diff and has no annotations', async () => {
    const oldDiff = makeDiff('removed.ts', [
      { type: 'context', oldNum: 1, newNum: 1, content: 'line 1' },
    ]);
    vi.mocked(getReviewFiles).mockResolvedValue([makeReviewFile('file1', 'removed.ts', oldDiff)]);
    vi.mocked(getAnnotationsForFile).mockResolvedValue([]);

    const result = await updateReviewDiffs('rev1', [], 'abc');

    expect(result).toEqual({ updated: 0, added: 0, stale: 0 });
    expect(deleteReviewFile).toHaveBeenCalledWith('file1');
    expect(markAnnotationStale).not.toHaveBeenCalled();
  });

  it('does not re-mark already stale annotations when content disappears', async () => {
    const oldDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 5, newNum: 5, content: 'hello' },
    ]);
    vi.mocked(getReviewFiles).mockResolvedValue([makeReviewFile('file1', 'foo.ts', oldDiff)]);

    const annotation = makeAnnotation({
      id: 'ann1',
      line_number: 5,
      side: 'new',
      is_stale: true,
      original_content: 'hello',
    });
    vi.mocked(getAnnotationsForFile).mockResolvedValue([annotation]);

    // Content gone from new diff
    const newDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 5, newNum: 5, content: 'world' },
    ]);

    const result = await updateReviewDiffs('rev1', [newDiff], 'abc');

    expect(result).toEqual({ updated: 1, added: 0, stale: 0 });
    expect(markAnnotationStale).not.toHaveBeenCalled();
  });

  it('restores previously stale annotation when content reappears at same position', async () => {
    const oldDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 5, newNum: 5, content: 'hello' },
    ]);
    vi.mocked(getReviewFiles).mockResolvedValue([makeReviewFile('file1', 'foo.ts', oldDiff)]);

    const annotation = makeAnnotation({
      id: 'ann1',
      line_number: 5,
      side: 'new',
      is_stale: true,
      original_content: 'hello',
    });
    vi.mocked(getAnnotationsForFile).mockResolvedValue([annotation]);

    // Content is back at the same position
    const newDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 5, newNum: 5, content: 'hello' },
    ]);

    const result = await updateReviewDiffs('rev1', [newDiff], 'abc');

    expect(result).toEqual({ updated: 1, added: 0, stale: 0 });
    expect(markAnnotationCurrent).toHaveBeenCalledWith('ann1');
    expect(moveAnnotation).not.toHaveBeenCalled();
  });

  it('updates HEAD commit', async () => {
    vi.mocked(getReviewFiles).mockResolvedValue([]);

    await updateReviewDiffs('rev1', [], 'newhead789');

    expect(updateReviewHead).toHaveBeenCalledWith('rev1', 'newhead789');
  });

  it('handles mixed scenario: update, remove, and add files', async () => {
    const existingDiff1 = makeDiff('updated.ts', [
      { type: 'context', oldNum: 1, newNum: 1, content: 'keep me' },
    ]);
    const existingDiff2 = makeDiff('removed.ts', [
      { type: 'context', oldNum: 1, newNum: 1, content: 'going away' },
    ]);

    vi.mocked(getReviewFiles).mockResolvedValue([
      makeReviewFile('file1', 'updated.ts', existingDiff1),
      makeReviewFile('file2', 'removed.ts', existingDiff2),
    ]);

    // updated.ts has an annotation; content shifts
    const ann1 = makeAnnotation({ id: 'ann1', review_file_id: 'file1', line_number: 1, side: 'new' });
    // removed.ts has an annotation that will become stale
    const ann2 = makeAnnotation({ id: 'ann2', review_file_id: 'file2', line_number: 1, side: 'new' });

    vi.mocked(getAnnotationsForFile).mockImplementation(async (fileId: string) => {
      if (fileId === 'file1') return [ann1];
      if (fileId === 'file2') return [ann2];
      return [];
    });

    const newDiffUpdated = makeDiff('updated.ts', [
      { type: 'add', oldNum: null, newNum: 1, content: 'new first line' },
      { type: 'context', oldNum: 1, newNum: 2, content: 'keep me' },
    ]);
    const newDiffAdded = makeDiff('brand-new.ts', [
      { type: 'add', oldNum: null, newNum: 1, content: 'I am new' },
    ]);

    const result = await updateReviewDiffs('rev1', [newDiffUpdated, newDiffAdded], 'head999');

    expect(result).toEqual({ updated: 1, added: 1, stale: 1 });

    // updated.ts: annotation migrated from line 1 to line 2
    expect(moveAnnotation).toHaveBeenCalledWith('ann1', 2, 'new');
    // updated.ts: diff updated
    expect(updateFileDiff).toHaveBeenCalledWith('file1', JSON.stringify(newDiffUpdated));

    // removed.ts: annotation marked stale
    expect(markAnnotationStale).toHaveBeenCalledWith('ann2', 'going away');
    // removed.ts: file NOT deleted (has annotations)
    expect(deleteReviewFile).not.toHaveBeenCalled();

    // brand-new.ts: added
    expect(addReviewFile).toHaveBeenCalledWith('rev1', 'brand-new.ts', JSON.stringify(newDiffAdded));

    // HEAD updated
    expect(updateReviewHead).toHaveBeenCalledWith('rev1', 'head999');
  });

  it('does not re-mark already stale annotations when file is removed from diff', async () => {
    const oldDiff = makeDiff('removed.ts', [
      { type: 'context', oldNum: 1, newNum: 1, content: 'line 1' },
    ]);
    vi.mocked(getReviewFiles).mockResolvedValue([makeReviewFile('file1', 'removed.ts', oldDiff)]);

    const staleAnn = makeAnnotation({
      id: 'ann1',
      line_number: 1,
      side: 'new',
      is_stale: true,
      original_content: 'line 1',
    });
    const freshAnn = makeAnnotation({ id: 'ann2', line_number: 1, side: 'new' });
    vi.mocked(getAnnotationsForFile).mockResolvedValue([staleAnn, freshAnn]);

    const result = await updateReviewDiffs('rev1', [], 'abc');

    // Only the fresh annotation gets marked stale
    expect(result).toEqual({ updated: 0, added: 0, stale: 1 });
    expect(markAnnotationStale).toHaveBeenCalledTimes(1);
    expect(markAnnotationStale).toHaveBeenCalledWith('ann2', 'line 1');
  });

  it('marks annotation stale when old content is not found in old diff', async () => {
    // Edge case: annotation references a line that does not exist in the old diff
    const oldDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 1, newNum: 1, content: 'only line' },
    ]);
    vi.mocked(getReviewFiles).mockResolvedValue([makeReviewFile('file1', 'foo.ts', oldDiff)]);

    // Annotation at line 99 which doesn't exist in oldDiff
    const annotation = makeAnnotation({ id: 'ann1', line_number: 99, side: 'new' });
    vi.mocked(getAnnotationsForFile).mockResolvedValue([annotation]);

    const newDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 1, newNum: 1, content: 'only line' },
    ]);

    const result = await updateReviewDiffs('rev1', [newDiff], 'abc');

    expect(result).toEqual({ updated: 1, added: 0, stale: 1 });
    expect(markAnnotationStale).toHaveBeenCalledWith('ann1', null);
  });

  it('does not migrate annotation when content moves beyond radius', async () => {
    const oldDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 5, newNum: 5, content: 'target' },
    ]);
    vi.mocked(getReviewFiles).mockResolvedValue([makeReviewFile('file1', 'foo.ts', oldDiff)]);

    const annotation = makeAnnotation({ id: 'ann1', line_number: 5, side: 'new' });
    vi.mocked(getAnnotationsForFile).mockResolvedValue([annotation]);

    // "target" exists but at line 50, far beyond the 10-line radius
    const newDiff = makeDiff('foo.ts', [
      { type: 'context', oldNum: 50, newNum: 50, content: 'target' },
    ]);

    const result = await updateReviewDiffs('rev1', [newDiff], 'abc');

    expect(result).toEqual({ updated: 1, added: 0, stale: 1 });
    expect(moveAnnotation).not.toHaveBeenCalled();
    expect(markAnnotationStale).toHaveBeenCalledWith('ann1', 'target');
  });

  it('migrates annotation on old side correctly', async () => {
    const oldDiff = makeDiff('foo.ts', [
      { type: 'remove', oldNum: 3, newNum: null, content: 'deleted line' },
    ]);
    vi.mocked(getReviewFiles).mockResolvedValue([makeReviewFile('file1', 'foo.ts', oldDiff)]);

    const annotation = makeAnnotation({ id: 'ann1', line_number: 3, side: 'old' });
    vi.mocked(getAnnotationsForFile).mockResolvedValue([annotation]);

    // In new diff, same content on old side but at line 5
    const newDiff = makeDiff('foo.ts', [
      { type: 'remove', oldNum: 5, newNum: null, content: 'deleted line' },
    ]);

    const result = await updateReviewDiffs('rev1', [newDiff], 'abc');

    expect(result).toEqual({ updated: 1, added: 0, stale: 0 });
    expect(moveAnnotation).toHaveBeenCalledWith('ann1', 5, 'old');
  });
});
