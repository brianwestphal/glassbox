import { buildFileContexts, formatContextsForPrompt, formatAdditionalContext } from '../../../src/ai/context-builder.js';
import type { ReviewFile } from '../../../src/db/queries.js';

function makeReviewFile(overrides: Partial<ReviewFile> & { file_path: string }): ReviewFile {
  return {
    id: 'test-id',
    review_id: 'review-1',
    file_path: overrides.file_path,
    status: overrides.status ?? 'modified',
    reviewed: overrides.reviewed ?? false,
    diff_data: overrides.diff_data ?? '{}',
  };
}

describe('buildFileContexts', () => {
  it('returns contexts for each file', () => {
    const files = [
      makeReviewFile({ file_path: 'src/a.ts', diff_data: '{"hunks":[], "status":"modified"}' }),
      makeReviewFile({ file_path: 'src/b.ts', diff_data: '{"hunks":[], "status":"added"}' }),
    ];
    const contexts = buildFileContexts(files, 10000);
    expect(contexts).toHaveLength(2);
    expect(contexts[0].filePath).toBe('src/a.ts');
    expect(contexts[1].filePath).toBe('src/b.ts');
  });

  it('counts added and removed lines', () => {
    const diff = {
      hunks: [{
        oldStart: 1, oldCount: 2, newStart: 1, newCount: 3,
        lines: [
          { type: 'context', content: 'unchanged', oldNum: 1, newNum: 1 },
          { type: 'remove', content: 'old line', oldNum: 2, newNum: null },
          { type: 'add', content: 'new line 1', oldNum: null, newNum: 2 },
          { type: 'add', content: 'new line 2', oldNum: null, newNum: 3 },
        ],
      }],
      status: 'modified',
    };
    const files = [makeReviewFile({ file_path: 'test.ts', diff_data: JSON.stringify(diff) })];
    const contexts = buildFileContexts(files, 10000);
    expect(contexts[0].linesAdded).toBe(2);
    expect(contexts[0].linesRemoved).toBe(1);
  });

  it('handles binary files', () => {
    const diff = { isBinary: true, hunks: [], status: 'modified' };
    const files = [makeReviewFile({ file_path: 'img.png', diff_data: JSON.stringify(diff) })];
    const contexts = buildFileContexts(files, 10000);
    expect(contexts[0].diffText).toBe('[Binary file]');
  });

  it('handles empty diffs', () => {
    const diff = { hunks: [], status: 'modified' };
    const files = [makeReviewFile({ file_path: 'empty.ts', diff_data: JSON.stringify(diff) })];
    const contexts = buildFileContexts(files, 10000);
    expect(contexts[0].diffText).toBe('[No changes]');
  });

  it('handles null/empty diff_data gracefully', () => {
    const files = [makeReviewFile({ file_path: 'test.ts', diff_data: '{"hunks":[]}' })];
    const contexts = buildFileContexts(files, 10000);
    expect(contexts[0].diffText).toBe('[No changes]');
  });

  it('summarizes hunks when diff exceeds character budget', () => {
    const longLines = Array.from({ length: 200 }, (_, i) => ({
      type: 'add' as const,
      content: `line ${i} with some content to fill the budget`,
      oldNum: null,
      newNum: i + 1,
    }));
    const diff = {
      hunks: [{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 200, lines: longLines }],
      status: 'added',
    };
    const files = [makeReviewFile({ file_path: 'big.ts', diff_data: JSON.stringify(diff) })];
    // Small budget forces summarization
    const contexts = buildFileContexts(files, 500);
    expect(contexts[0].diffText).toContain('lines omitted');
  });
});

describe('formatContextsForPrompt', () => {
  it('formats contexts with file headers', () => {
    const result = formatContextsForPrompt([
      { fileId: '1', filePath: 'src/a.ts', status: 'modified', linesAdded: 5, linesRemoved: 2, diffText: '+new line' },
    ]);
    expect(result).toContain('=== src/a.ts (modified, +5 -2) ===');
    expect(result).toContain('+new line');
  });

  it('joins multiple files with double newline', () => {
    const result = formatContextsForPrompt([
      { fileId: '1', filePath: 'a.ts', status: 'added', linesAdded: 1, linesRemoved: 0, diffText: '+a' },
      { fileId: '2', filePath: 'b.ts', status: 'deleted', linesAdded: 0, linesRemoved: 1, diffText: '-b' },
    ]);
    expect(result).toContain('=== a.ts (added, +1 -0) ===');
    expect(result).toContain('=== b.ts (deleted, +0 -1) ===');
  });
});

describe('formatAdditionalContext', () => {
  it('formats file contents with headers', () => {
    const result = formatAdditionalContext([
      { path: 'src/utils.ts', content: 'export function foo() {}' },
    ]);
    expect(result).toContain('=== Full content: src/utils.ts ===');
    expect(result).toContain('export function foo() {}');
  });

  it('joins multiple files', () => {
    const result = formatAdditionalContext([
      { path: 'a.ts', content: 'a' },
      { path: 'b.ts', content: 'b' },
    ]);
    expect(result).toContain('Full content: a.ts');
    expect(result).toContain('Full content: b.ts');
  });
});
