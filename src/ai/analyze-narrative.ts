import type { ReviewFile } from '../db/queries.js';
import { getFileContent } from '../git/diff.js';
import type { AIMessage } from './client.js';
import { sendAIRequest } from './client.js';
import type { AIConfig, GuidedReviewConfig } from './config.js';
import { buildFileContexts, formatAdditionalContext, formatContextsForPrompt } from './context-builder.js';
import { buildGuidedReviewSuffix } from './guided-review.js';
import { getModelContextWindow } from './models.js';
import { extractJSON, isNeedContext } from './shared.js';

const SYSTEM_PROMPT = `You are a JSON-only API. You output raw JSON with no other text, no markdown fences, no explanation.

TASK: Determine the best reading order for a human reviewing these code changes, and provide walkthrough notes for each file.

PRINCIPLES for ordering:
1. Types/interfaces/data models first (foundations)
2. Utility functions and shared helpers next
3. Core business logic, ordered by dependency
4. Integration code (routes, controllers, event handlers)
5. Configuration and build files
6. Tests last

For each file, provide walkthrough notes to guide the reviewer:
- "overview": A 1-2 sentence summary explaining what changed in this file and why it matters in the reading order
- "lines": An array of specific line-level walkthrough notes referencing NEW-side line numbers from the diff. Highlight key changes, important patterns, and connections to other files. Each entry has "line" (number) and "content" (brief note).

OUTPUT FORMAT — you MUST output ONLY this JSON array, nothing else:
[{"filePath":"src/types.ts","position":1,"rationale":"Defines core interfaces","notes":{"overview":"Start here: these new types are used throughout the rest of the changes","lines":[{"line":10,"content":"This interface is the foundation for the new feature in routes.ts"}]}}]

Every file in the diff must appear exactly once.

If you need full file content to determine dependencies, output ONLY: {"needContext":["path/to/file.ts"]}

CRITICAL: Your entire response must be parseable by JSON.parse(). No prose, no markdown, no explanation.`;


export interface NarrativeFileNotes {
  overview: string;
  lines: Array<{ line: number; content: string }>;
}

export interface NarrativeFileResult {
  filePath: string;
  position: number;
  rationale: string;
  notes?: NarrativeFileNotes;
}

/** Analyze a single batch of files for narrative reading order. */
export async function runNarrativeAnalysisBatch(
  files: ReviewFile[],
  config: AIConfig,
  repoRoot: string,
  guidedReview?: GuidedReviewConfig,
): Promise<NarrativeFileResult[]> {
  const contextWindow = getModelContextWindow(config.platform, config.model);
  const charBudget = Math.floor(contextWindow * 0.7 * 3);

  const systemPrompt = SYSTEM_PROMPT + (guidedReview !== undefined
    ? buildGuidedReviewSuffix(guidedReview, 'narrative') : '');

  const contexts = buildFileContexts(files, charBudget);
  const validPaths = new Set(files.map(f => f.file_path));

  const initialPrompt = [
    `Determine the best reading order for reviewing these ${String(files.length)} changed files:`,
    '',
    formatContextsForPrompt(contexts),
  ].join('\n');

  const messages: AIMessage[] = [{ role: 'user', content: initialPrompt }];

  for (let round = 0; round < 3; round++) {
    const response = await sendAIRequest(config, systemPrompt, messages);
    const parsed = extractJSON(response.content);

    if (isNeedContext(parsed)) {
      const safePaths = parsed.needContext.filter(p => validPaths.has(p));
      if (safePaths.length === 0) {
        throw new Error('AI requested context for files not in the review');
      }

      const fileContents = safePaths.map(path => ({
        path,
        content: getFileContent(path, 'working', repoRoot),
      }));

      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: `Here is the full content of the requested files:\n\n${formatAdditionalContext(fileContents)}`,
      });
      continue;
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Expected an array of narrative ordering from AI');
    }

    return parsed as NarrativeFileResult[];
  }

  throw new Error('Narrative analysis did not converge after 3 context rounds');
}

/**
 * Merge batch-level narrative orderings into a single global reading order.
 * Uses a deterministic round-robin interleave: takes position-1 files from
 * each batch first, then position-2, etc. This preserves each batch's
 * internal ordering while interleaving across batches.
 * Returns a map of filePath → global position (1-based).
 */
export function mergeNarrativeOrders(
  batchResults: NarrativeFileResult[],
  batchCount: number,
): Map<string, number> {
  if (batchCount <= 1) {
    return new Map(batchResults.map(r => [r.filePath, r.position]));
  }

  // Group results by which batch they came from (using their position ranges)
  // Since batches are processed sequentially via runBatches with concurrency=1,
  // results arrive in batch order. We reconstruct batches by finding position resets.
  const batches: NarrativeFileResult[][] = [];
  let currentBatch: NarrativeFileResult[] = [];
  let lastPos = 0;

  // Sort by original insertion order — results from runBatches are concatenated in batch order
  // Within each batch, sort by position
  const sorted = batchResults.slice();

  // Split into batches: detect when position resets (goes down)
  for (const r of sorted) {
    if (r.position <= lastPos && currentBatch.length > 0) {
      // Position went down — new batch
      batches.push(currentBatch.slice().sort((a, b) => a.position - b.position));
      currentBatch = [];
    }
    currentBatch.push(r);
    lastPos = r.position;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch.slice().sort((a, b) => a.position - b.position));
  }

  // Round-robin interleave: take position-1 from each batch, then position-2, etc.
  const merged: string[] = [];
  const maxLen = Math.max(...batches.map(b => b.length));
  for (let i = 0; i < maxLen; i++) {
    for (const batch of batches) {
      if (i < batch.length) {
        merged.push(batch[i].filePath);
      }
    }
  }

  const positions = new Map<string, number>();
  for (let i = 0; i < merged.length; i++) {
    positions.set(merged[i], i + 1);
  }
  return positions;
}

/**
 * Run narrative analysis across all files (legacy single-batch entry point).
 * Prefer using planBatches + runBatches + runNarrativeAnalysisBatch for large reviews.
 */
export async function runNarrativeAnalysis(
  files: ReviewFile[],
  config: AIConfig,
  repoRoot: string,
  guidedReview?: GuidedReviewConfig,
): Promise<NarrativeFileResult[]> {
  return runNarrativeAnalysisBatch(files, config, repoRoot, guidedReview);
}
