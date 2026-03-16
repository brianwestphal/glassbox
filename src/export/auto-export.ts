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
    void generateReviewExport(reviewId, repoRoot, true);
  }, DEBOUNCE_MS);
}

/** Flush any pending auto-export immediately (e.g. on server shutdown). */
export function flushAutoExport(reviewId: string, repoRoot: string) {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    void generateReviewExport(reviewId, repoRoot, true);
  }
}
