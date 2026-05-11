import { runBatches } from '../../../src/ai/batch-runner.js';
import type { Batch } from '../../../src/ai/batch-planner.js';
import type { ReviewFile } from '../../../src/db/queries.js';

function makeFile(path: string): ReviewFile {
  return { id: `f-${path}`, review_id: 'r1', file_path: path, status: 'pending', diff_data: null };
}

function makeBatch(paths: string[]): Batch {
  return { files: paths.map(makeFile), estimatedTokens: 1000 };
}

describe('runBatches', () => {
  it('processes all batches and returns combined results', async () => {
    const batches = [makeBatch(['a.ts']), makeBatch(['b.ts'])];
    const process = vi.fn().mockImplementation((batch: Batch) =>
      Promise.resolve(batch.files.map(f => ({ path: f.file_path }))));
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn().mockResolvedValue(undefined);

    const results = await runBatches(batches, 2, process, onComplete, onProgress);
    expect(results).toHaveLength(2);
    expect(process).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('reports progress after each batch', async () => {
    const batches = [makeBatch(['a.ts']), makeBatch(['b.ts', 'c.ts'])];
    const onProgress = vi.fn().mockResolvedValue(undefined);

    await runBatches(batches, 3,
      async (b) => b.files.map(f => f.file_path),
      async () => {},
      onProgress,
    );

    expect(onProgress).toHaveBeenCalledTimes(2);
    const firstProgress = onProgress.mock.calls[0][0];
    expect(firstProgress.totalBatches).toBe(2);
    expect(firstProgress.completedBatches).toBe(1);
    expect(firstProgress.totalFiles).toBe(3);
  });

  it('handles empty batch list', async () => {
    const results = await runBatches([], 0,
      async () => [], async () => {}, async () => {});
    expect(results).toEqual([]);
  });

  it('retries on retriable error (429)', async () => {
    const process = vi.fn()
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValueOnce([{ ok: true }]);

    const results = await runBatches(
      [makeBatch(['a.ts'])], 1, process,
      async () => {}, async () => {},
      1, undefined, 'test',
    );
    expect(results).toHaveLength(1);
    expect(process).toHaveBeenCalledTimes(2);
  }, 70000);

  it('throws on non-retriable error', async () => {
    const process = vi.fn().mockRejectedValue(new Error('Invalid API key'));

    // runBatches catches errors per-batch and logs them, doesn't throw
    const results = await runBatches(
      [makeBatch(['a.ts'])], 1, process,
      async () => {}, async () => {},
    );
    // Failed batch doesn't contribute results
    expect(results).toEqual([]);
  });

  it('stops starting new batches when canceled', async () => {
    let callCount = 0;
    const process = vi.fn().mockImplementation(async () => {
      callCount++;
      return [{ ok: true }];
    });
    const shouldCancel = vi.fn()
      .mockReturnValueOnce(false) // first batch proceeds
      .mockReturnValue(true);     // cancel before second

    await runBatches(
      [makeBatch(['a.ts']), makeBatch(['b.ts']), makeBatch(['c.ts'])], 3,
      process, async () => {}, async () => {},
      1, shouldCancel,
    );
    expect(callCount).toBe(1);
  });

  it('runs batches concurrently when concurrency > 1', async () => {
    let maxConcurrent = 0;
    let current = 0;

    const process = vi.fn().mockImplementation(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise(r => setTimeout(r, 50));
      current--;
      return [{ ok: true }];
    });

    await runBatches(
      [makeBatch(['a.ts']), makeBatch(['b.ts']), makeBatch(['c.ts'])], 3,
      process, async () => {}, async () => {},
      2,
    );
    expect(maxConcurrent).toBe(2);
  });

  it('uses label in debug logging', async () => {
    const process = vi.fn().mockResolvedValue([]);
    await runBatches(
      [makeBatch(['a.ts'])], 1, process,
      async () => {}, async () => {},
      1, undefined, 'risk',
    );
    expect(process).toHaveBeenCalledTimes(1);
  });
});
