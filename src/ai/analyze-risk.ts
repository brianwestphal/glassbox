import type { ReviewFile } from '../db/queries.js';
import type { AIConfig, GuidedReviewConfig } from './config.js';
import { buildGuidedReviewSuffix } from './guided-review.js';
import { runAnalysisBatch } from './shared.js';

const SYSTEM_PROMPT = `You are a JSON-only API. You output raw JSON with no other text, no markdown fences, no explanation.

TASK: Evaluate each changed file across these risk dimensions on a 0.0 to 1.0 scale (0.0 = no concern, 1.0 = critical):

1. security - Injection vulnerabilities, auth gaps, data exposure, insecure crypto, path traversal
2. correctness - Logic errors, off-by-one, null handling, type safety, race conditions
3. error-handling - Missing catches, unvalidated input, silent failures
4. maintainability - Complexity, coupling, unclear naming, magic numbers
5. architecture - Separation of concerns, dependency direction, scalability, API design
6. performance - Algorithmic complexity, memory management, unnecessary allocation

For each file, also provide detailed notes:
- "overview": A 1-2 sentence summary of the key risk concerns for this file
- "lines": An array of specific line-level observations referencing NEW-side line numbers from the diff. Focus on the most important risks, not every line. Each entry has "line" (number) and "content" (brief note).

OUTPUT FORMAT — you MUST output ONLY this JSON array, nothing else:
[{"filePath":"src/example.ts","scores":{"security":0.2,"correctness":0.5,"error-handling":0.3,"maintainability":0.4,"architecture":0.1,"performance":0.2},"aggregate":0.35,"rationale":"Brief concern","notes":{"overview":"Key risk summary for this file","lines":[{"line":42,"content":"SQL injection: user input not parameterized"}]}}]

The aggregate should be the MAX of all individual dimension scores (if a file has one critical issue, the aggregate should reflect that).

If you need full file content to assess accurately, output ONLY: {"needContext":["path/to/file.ts"]}

CRITICAL: Your entire response must be parseable by JSON.parse(). No prose, no markdown, no explanation.`;

export const RISK_DIMENSIONS = [
  'security',
  'correctness',
  'error-handling',
  'maintainability',
  'architecture',
  'performance',
] as const;

export type RiskDimension = typeof RISK_DIMENSIONS[number];

export interface FileNotes {
  overview: string;
  lines: Array<{ line: number; content: string }>;
}

export interface RiskFileResult {
  filePath: string;
  scores: Record<RiskDimension, number>;
  aggregate: number;
  rationale: string;
  notes?: FileNotes;
}

/** Analyze a single batch of files for risk. Used by the batch runner. */
export function runRiskAnalysisBatch(
  files: ReviewFile[],
  config: AIConfig,
  repoRoot: string,
  guidedReview?: GuidedReviewConfig,
): Promise<RiskFileResult[]> {
  const systemPrompt = SYSTEM_PROMPT + (guidedReview !== undefined
    ? buildGuidedReviewSuffix(guidedReview, 'risk') : '');

  return runAnalysisBatch<RiskFileResult>(files, config, repoRoot, {
    systemPrompt,
    initialPromptHeader: (n) => `Analyze the following ${String(n)} file diffs for risk:`,
    resultLabel: 'risk assessments',
    analysisName: 'Risk analysis',
  });
}
