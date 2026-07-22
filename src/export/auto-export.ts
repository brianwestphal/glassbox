import { generateReviewExport } from './generate.js';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 2000;

/**
 * Schedule an auto-export of latest-review.md, debounced.
 * Multiple calls within DEBOUNCE_MS will only trigger one export.
 */
export function scheduleAutoExport(reviewId: string, repoRoot: string) {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    // Belt-and-suspenders .catch: an export failure inside the debounce timer
    // (e.g. the review was deleted before the timer fired) would otherwise be
    // an unhandled rejection, which terminates modern Node.
    generateReviewExport(reviewId, repoRoot, true).catch((err: unknown) => {
      console.error('Auto-export failed:', err instanceof Error ? err.message : err);
    });
  }, DEBOUNCE_MS);
}

/** Flush any pending auto-export immediately (e.g. on server shutdown). */
export function flushAutoExport(reviewId: string, repoRoot: string) {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    generateReviewExport(reviewId, repoRoot, true).catch((err: unknown) => {
      console.error('Auto-export flush failed:', err instanceof Error ? err.message : err);
    });
  }
}
