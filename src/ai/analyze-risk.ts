import type { ReviewFile } from '../db/queries.js';
import { getFileContent } from '../git/diff.js';
import type { AIMessage } from './client.js';
import { sendAIRequest } from './client.js';
import type { AIConfig } from './config.js';
import { buildFileContexts, formatAdditionalContext, formatContextsForPrompt } from './context-builder.js';
import { getModelContextWindow } from './models.js';
import { extractJSON, isNeedContext } from './shared.js';

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
export async function runRiskAnalysisBatch(
  files: ReviewFile[],
  config: AIConfig,
  repoRoot: string,
): Promise<RiskFileResult[]> {
  const contextWindow = getModelContextWindow(config.platform, config.model);
  // Reserve ~30% for output and system prompt
  const charBudget = Math.floor(contextWindow * 0.7 * 3); // rough chars-to-tokens ratio

  const contexts = buildFileContexts(files, charBudget);
  const validPaths = new Set(files.map(f => f.file_path));

  const initialPrompt = [
    `Analyze the following ${String(files.length)} file diffs for risk:`,
    '',
    formatContextsForPrompt(contexts),
  ].join('\n');

  const messages: AIMessage[] = [{ role: 'user', content: initialPrompt }];

  for (let round = 0; round < 3; round++) {
    const response = await sendAIRequest(config, SYSTEM_PROMPT, messages);
    const parsed = extractJSON(response.content);

    if (isNeedContext(parsed)) {
      // Validate requested paths against actual review files
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

    // Should be the final result array
    if (!Array.isArray(parsed)) {
      throw new Error('Expected an array of risk assessments from AI');
    }

    return parsed as RiskFileResult[];
  }

  throw new Error('Risk analysis did not converge after 3 context rounds');
}

/**
 * Run risk analysis across all files (legacy single-batch entry point).
 * Prefer using planBatches + runBatches + runRiskAnalysisBatch for large reviews.
 */
export async function runRiskAnalysis(
  files: ReviewFile[],
  config: AIConfig,
  repoRoot: string,
): Promise<RiskFileResult[]> {
  return runRiskAnalysisBatch(files, config, repoRoot);
}
