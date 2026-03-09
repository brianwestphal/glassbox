import type { ReviewFile } from '../db/queries.js';
import { debugLog } from '../debug.js';
import type { FileDiff } from '../git/diff.js';

export interface Batch {
  files: ReviewFile[];
  estimatedTokens: number;
}

export interface BatchPlan {
  batches: Batch[];
  binaryFiles: ReviewFile[];
}

function parseDiff(file: ReviewFile): FileDiff {
  return JSON.parse(
    file.diff_data !== null && file.diff_data !== '' ? file.diff_data : '{}'
  ) as FileDiff;
}

function isBinary(file: ReviewFile): boolean {
  const diff = parseDiff(file);
  return diff.isBinary;
}

/** Estimate token count for a file's diff (rough: 1 token ~ 3 chars) */
function estimateFileTokens(file: ReviewFile): number {
  const diff = parseDiff(file);
  if (diff.isBinary) return 0;
  // hunks may be missing when diff_data is '{}' (runtime data from JSON.parse)
  const hunks = (diff as Partial<FileDiff>).hunks;
  if (!hunks) return 0;

  let charCount = 0;
  for (const hunk of hunks) {
    // Hunk header
    charCount += 40;
    for (const line of hunk.lines) {
      charCount += line.content.length + 2; // +2 for prefix and newline
    }
  }
  // Add file path and formatting overhead
  charCount += file.file_path.length + 80;
  return Math.ceil(charCount / 3);
}

// Target batch size — small enough to stay under typical rate limits
// (many API tiers have 30-80k input tokens/min). 20k leaves room for
// system prompt overhead and avoids hitting per-request limits.
const DEFAULT_BATCH_TOKEN_LIMIT = 20_000;

/**
 * Partition files into batches that fit within token limits.
 * Binary files are excluded and returned separately.
 */
export function planBatches(
  files: ReviewFile[],
  contextWindowTokens: number,
): BatchPlan {
  const binaryFiles: ReviewFile[] = [];
  const analyzableFiles: Array<{ file: ReviewFile; tokens: number }> = [];

  for (const file of files) {
    if (isBinary(file)) {
      binaryFiles.push(file);
    } else {
      analyzableFiles.push({ file, tokens: estimateFileTokens(file) });
    }
  }

  if (analyzableFiles.length === 0) {
    return { batches: [], binaryFiles };
  }

  // Use the smaller of a fixed practical limit and context-window-derived limit.
  // The context window cap ensures we never exceed what the model can handle;
  // the practical cap keeps batches small for rate-limit friendliness.
  const contextCap = Math.floor(contextWindowTokens * 0.7 * 0.85);
  const batchTokenLimit = Math.min(DEFAULT_BATCH_TOKEN_LIMIT, contextCap);

  // Sort by token count descending so large files get placed first
  analyzableFiles.sort((a, b) => b.tokens - a.tokens);

  const batches: Batch[] = [];
  const placed = new Set<number>();

  // Greedy bin-packing: first-fit decreasing
  for (let i = 0; i < analyzableFiles.length; i++) {
    if (placed.has(i)) continue;

    const entry = analyzableFiles[i];
    // Start a new batch with this file
    const batchFiles: ReviewFile[] = [entry.file];
    let batchTokens = entry.tokens;
    placed.add(i);

    // Try to fit more files into this batch
    for (let j = i + 1; j < analyzableFiles.length; j++) {
      if (placed.has(j)) continue;
      const candidate = analyzableFiles[j];
      if (batchTokens + candidate.tokens <= batchTokenLimit) {
        batchFiles.push(candidate.file);
        batchTokens += candidate.tokens;
        placed.add(j);
      }
    }

    batches.push({ files: batchFiles, estimatedTokens: batchTokens });
  }

  debugLog(`Batch plan: ${String(analyzableFiles.length)} analyzable files, ${String(binaryFiles.length)} binary files → ${String(batches.length)} batch(es), limit ${String(batchTokenLimit)} tokens/batch`);
  for (let i = 0; i < batches.length; i++) {
    debugLog(`  Batch ${String(i)}: ${String(batches[i].files.length)} files, ~${String(batches[i].estimatedTokens)} tokens`);
  }

  return { batches, binaryFiles };
}
