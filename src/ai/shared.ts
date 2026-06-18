/** Shared utilities for AI analysis modules */

import { z } from 'zod';

import type { ReviewFile } from '../db/queries.js';
import { getFileContent } from '../git/diff.js';
import { reviewNotesPromptSection } from '../review-notes/format.js';
import type { AIMessage } from './client.js';
import { sendAIRequest } from './client.js';
import type { AIConfig } from './config.js';
import { buildFileContexts, formatAdditionalContext, formatContextsForPrompt } from './context-builder.js';
import { getModelContextWindow } from './models.js';

export const NeedContextResponseSchema = z.object({
  needContext: z.array(z.string()),
});
export type NeedContextResponse = z.infer<typeof NeedContextResponseSchema>;

export function isNeedContext(parsed: unknown): parsed is NeedContextResponse {
  return NeedContextResponseSchema.safeParse(parsed).success;
}

/** Try to extract JSON from a response that may contain surrounding prose */
export function extractJSON(text: string): unknown {
  const stripped = text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(stripped);
  } catch { /* continue */ }

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch !== null) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch { /* continue */ }
  }

  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch !== null) {
    try {
      return JSON.parse(objMatch[0]);
    } catch { /* continue */ }
  }

  throw new Error(`Could not extract JSON from AI response: ${text.slice(0, 300)}`);
}

interface AnalysisBatchOptions<T> {
  /** System prompt to send with every round. */
  systemPrompt: string;
  /** Builds the first line of the user prompt (e.g. "Analyze the following 5 file diffs for risk:"). */
  initialPromptHeader: (fileCount: number) => string;
  /** Label used in the "Expected an array of …" error message. */
  resultLabel: string;
  /** Label for the "Risk/Narrative/Guided analysis did not converge…" error. */
  analysisName: string;
  /** zod schema for a single result element. The whole array is parsed
   *  through `z.array(itemSchema)` so a malformed entry fails loudly
   *  instead of slipping through the previous `as T[]` cast. */
  itemSchema: z.ZodType<T>;
}

/**
 * Multi-turn-context loop shared by `analyze-risk`, `analyze-narrative`, and
 * `analyze-guided`. Builds the user prompt from the file diffs, then loops up
 * to 3 rounds: send → `extractJSON` → if `needContext`, attach file contents
 * and resend; else return the parsed array.
 *
 * Each analyze-*.ts module supplies a system prompt plus a couple of label
 * strings; everything else is identical.
 */
export async function runAnalysisBatch<T>(
  files: ReviewFile[],
  config: AIConfig,
  repoRoot: string,
  options: AnalysisBatchOptions<T>,
): Promise<T[]> {
  const contextWindow = getModelContextWindow(config.platform, config.model);
  // Reserve ~30% of the context window for output and system prompt.
  // Multiply by 3 for the rough chars-to-tokens ratio.
  const charBudget = Math.floor(contextWindow * 0.7 * 3);

  const contexts = buildFileContexts(files, charBudget);
  const validPaths = new Set(files.map(f => f.file_path));

  // Fold in the author's own AI review notes (docs/20 §20.8, P5) so analysis is
  // informed by their stated risks/assumptions/rationale.
  const notesSection = reviewNotesPromptSection(repoRoot, files.map(f => f.file_path));

  const initialPrompt = [
    options.initialPromptHeader(files.length),
    '',
    formatContextsForPrompt(contexts),
    ...(notesSection === '' ? [] : ['', notesSection]),
  ].join('\n');

  const messages: AIMessage[] = [{ role: 'user', content: initialPrompt }];

  for (let round = 0; round < 3; round++) {
    const response = await sendAIRequest(config, options.systemPrompt, messages);
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

    // Models reliably return a JSON array for multi-file batches, but for a
    // single-file batch they very often drop the wrapper and return a bare
    // object (`{...}` instead of `[{...}]`). Normalize a lone object to a
    // one-element array so single-file analyses (e.g. guided review on a
    // one-file review) parse instead of erroring out (GB-915). A non-matching
    // object still fails the schema below, preserving the loud-failure contract.
    const candidate = Array.isArray(parsed) ? parsed : [parsed];
    const arrayResult = z.array(options.itemSchema).safeParse(candidate);
    if (!arrayResult.success) {
      const summary = arrayResult.error.issues
        .slice(0, 3)
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`Expected an array of ${options.resultLabel} from AI — ${summary}`);
    }
    return arrayResult.data;
  }

  throw new Error(`${options.analysisName} did not converge after 3 context rounds`);
}
