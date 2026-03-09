import { debugLog } from '../debug.js';
import type { Batch } from './batch-planner.js';

export interface BatchProgress {
  totalBatches: number;
  completedBatches: number;
  totalFiles: number;
  completedFiles: number;
}

/**
 * Run batches with controlled concurrency.
 * Calls onBatchComplete after each batch finishes.
 * Retries retriable errors (429, 5xx) once with backoff.
 * If shouldCancel returns true, no new batches are started (in-flight ones finish).
 */
export async function runBatches<T>(
  batches: Batch[],
  totalFiles: number,
  processBatch: (batch: Batch, batchIndex: number) => Promise<T[]>,
  onBatchComplete: (batchIndex: number, results: T[]) => Promise<void>,
  onProgress: (progress: BatchProgress) => Promise<void>,
  concurrency: number = 1,
  shouldCancel?: () => boolean,
  label: string = '',
): Promise<T[]> {
  const tag = label !== '' ? `[${label}] ` : '';
  const allResults: T[] = [];
  let completedBatches = 0;
  let completedFiles = 0;

  const progress = (): BatchProgress => ({
    totalBatches: batches.length,
    completedBatches,
    totalFiles,
    completedFiles,
  });

  async function runOne(batch: Batch, index: number): Promise<void> {
    debugLog(`${tag}Batch ${String(index)} starting: ${String(batch.files.length)} files, ~${String(batch.estimatedTokens)} tokens`);
    let results: T[];
    try {
      results = await processBatch(batch, index);
    } catch (err: unknown) {
      // Retry once for retriable errors
      if (isRetriable(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        debugLog(`${tag}Batch ${String(index)} hit retriable error, waiting 30-60s: ${msg.slice(0, 120)}`);
        const delay = 30000 + Math.random() * 30000;
        await sleep(delay);
        debugLog(`${tag}Batch ${String(index)} retrying...`);
        results = await processBatch(batch, index);
      } else {
        throw err;
      }
    }

    debugLog(`${tag}Batch ${String(index)} completed: ${String(results.length)} results`);
    allResults.push(...results);
    completedBatches++;
    completedFiles += batch.files.length;

    await onBatchComplete(index, results);
    await onProgress(progress());
  }

  // Run with concurrency limit
  let nextIndex = 0;
  const running = new Set<Promise<void>>();

  while (nextIndex < batches.length || running.size > 0) {
    // Start new batches up to concurrency limit — but not if cancelled
    while (nextIndex < batches.length && running.size < concurrency) {
      if (shouldCancel !== undefined && shouldCancel()) {
        debugLog(`${tag}Batch runner cancelled — skipping batch ${String(nextIndex)} and ${String(batches.length - nextIndex - 1)} remaining`);
        // Skip all remaining batches
        nextIndex = batches.length;
        break;
      }
      const idx = nextIndex++;
      const batch = batches[idx];
      const p = runOne(batch, idx).catch((err: unknown) => {
        // Log but don't abort other batches — failed files just won't have scores
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag}Batch ${String(idx)} failed: ${msg}`);
        completedBatches++;
        void onProgress(progress());
      });
      running.add(p);
      void p.then(() => { running.delete(p); });
    }

    // Wait for at least one to finish before continuing
    if (running.size > 0) {
      await Promise.race(running);
    }
  }

  return allResults;
}

function isRetriable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return msg.includes('429') || msg.includes('500') || msg.includes('502') ||
    msg.includes('503') || msg.includes('504') || msg.includes('rate_limit');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}
