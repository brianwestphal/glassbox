import { describe, it, expect } from 'vitest';
import { planBatches } from '../../../src/ai/batch-planner.js';
import type { ReviewFile } from '../../../src/db/queries.js';

function makeFile(path: string, diffContent: string, isBinary = false): ReviewFile {
  const diff = {
    filePath: path,
    oldPath: null,
    status: 'modified',
    hunks: isBinary ? [] : [{
      oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
      lines: [{ type: 'add', oldNum: null, newNum: 1, content: diffContent }],
    }],
    isBinary,
  };
  return {
    id: path,
    review_id: 'r1',
    file_path: path,
    status: 'pending',
    diff_data: JSON.stringify(diff),
    created_at: '',
  };
}

describe('planBatches', () => {
  it('returns empty batches and binaryFiles for empty file list', () => {
    const result = planBatches([], 100_000);
    expect(result).toEqual({ batches: [], binaryFiles: [] });
  });

  it('places a single small file into one batch', () => {
    const file = makeFile('src/index.ts', 'console.log("hello");');
    const result = planBatches([file], 100_000);

    expect(result.batches).toHaveLength(1);
    expect(result.batches[0].files).toHaveLength(1);
    expect(result.batches[0].files[0].file_path).toBe('src/index.ts');
    expect(result.batches[0].estimatedTokens).toBeGreaterThan(0);
    expect(result.binaryFiles).toHaveLength(0);
  });

  it('separates binary files from analyzable files', () => {
    const binary = makeFile('image.png', '', true);
    const text = makeFile('src/app.ts', 'const x = 1;');
    const result = planBatches([binary, text], 100_000);

    expect(result.binaryFiles).toHaveLength(1);
    expect(result.binaryFiles[0].file_path).toBe('image.png');
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0].files).toHaveLength(1);
    expect(result.batches[0].files[0].file_path).toBe('src/app.ts');
  });

  it('packs multiple small files into one batch', () => {
    const files = [
      makeFile('a.ts', 'const a = 1;'),
      makeFile('b.ts', 'const b = 2;'),
      makeFile('c.ts', 'const c = 3;'),
    ];
    const result = planBatches(files, 100_000);

    expect(result.batches).toHaveLength(1);
    expect(result.batches[0].files).toHaveLength(3);
    expect(result.binaryFiles).toHaveLength(0);
  });

  it('splits large files into multiple batches', () => {
    // Each file needs to be large enough that two won't fit in a single 20k-token batch.
    // ~1 token per 3 chars, so 40,000 chars ~ 13,333 tokens + overhead.
    const longContent = 'x'.repeat(40_000);
    const files = [
      makeFile('big1.ts', longContent),
      makeFile('big2.ts', longContent),
      makeFile('big3.ts', longContent),
    ];
    const result = planBatches(files, 200_000);

    expect(result.batches.length).toBeGreaterThanOrEqual(2);
    // Each batch should have at most the token limit worth of files
    for (const batch of result.batches) {
      expect(batch.estimatedTokens).toBeLessThanOrEqual(20_000);
    }
    // All files should be placed
    const totalFiles = result.batches.reduce((sum, b) => sum + b.files.length, 0);
    expect(totalFiles).toBe(3);
    expect(result.binaryFiles).toHaveLength(0);
  });

  it('handles mixed binary and non-binary files', () => {
    const files = [
      makeFile('src/a.ts', 'const a = 1;'),
      makeFile('logo.png', '', true),
      makeFile('src/b.ts', 'const b = 2;'),
      makeFile('photo.jpg', '', true),
    ];
    const result = planBatches(files, 100_000);

    expect(result.binaryFiles).toHaveLength(2);
    expect(result.binaryFiles.map(f => f.file_path).sort()).toEqual(['logo.png', 'photo.jpg']);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0].files).toHaveLength(2);
  });

  it('caps batch size based on context window tokens', () => {
    // With contextWindowTokens = 1000, cap = floor(1000 * 0.7 * 0.85) = 595
    // This is smaller than DEFAULT_BATCH_TOKEN_LIMIT (20k), so it should be used.
    // A file with ~2000 chars = ~667 tokens (over cap), so each goes in its own batch.
    const content = 'y'.repeat(2000);
    const files = [
      makeFile('a.ts', content),
      makeFile('b.ts', content),
    ];
    const result = planBatches(files, 1000);

    // Each file's tokens exceed the context cap, so they go in separate batches
    expect(result.batches.length).toBe(2);
    expect(result.binaryFiles).toHaveLength(0);
  });

  it('returns only binaryFiles when all files are binary', () => {
    const files = [
      makeFile('a.png', '', true),
      makeFile('b.jpg', '', true),
      makeFile('c.gif', '', true),
    ];
    const result = planBatches(files, 100_000);

    expect(result.batches).toHaveLength(0);
    expect(result.binaryFiles).toHaveLength(3);
  });
});
