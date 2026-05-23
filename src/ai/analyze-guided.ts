import { z } from 'zod';

import type { ReviewFile } from '../db/queries.js';
import type { AIConfig, GuidedReviewConfig } from './config.js';
import { runAnalysisBatch } from './shared.js';

const TOPIC_DISPLAY: Record<string, string> = {
  programming: 'programming in general',
  codebase: 'this codebase',
  javascript: 'JavaScript', python: 'Python', typescript: 'TypeScript',
  java: 'Java', csharp: 'C#', cpp: 'C++', go: 'Go', rust: 'Rust',
  php: 'PHP', swift: 'Swift', ruby: 'Ruby', kotlin: 'Kotlin',
  scala: 'Scala', c: 'C', objectivec: 'Objective-C', r: 'R',
  lua: 'Lua', perl: 'Perl', bash: 'Shell scripting', dart: 'Dart',
  elixir: 'Elixir', erlang: 'Erlang', haskell: 'Haskell',
  clojure: 'Clojure', ocaml: 'OCaml', zig: 'Zig', nim: 'Nim',
  groovy: 'Groovy',
};

function buildSystemPrompt(config: GuidedReviewConfig): string {
  const topicNames = config.topics.map(t => TOPIC_DISPLAY[t] ?? t);
  const topicList = topicNames.join(', ');

  const hasLang = config.topics.some(t => t !== 'programming' && t !== 'codebase');
  const newToProgramming = config.topics.includes('programming');
  const newToCodebase = config.topics.includes('codebase');

  let focusInstructions = '';
  if (newToProgramming) {
    focusInstructions += `
- Explain basic programming concepts (variables, functions, control flow, types) when they appear
- Define technical terms the first time you use them
- Explain WHY code is structured a certain way, not just what it does`;
  }
  if (newToCodebase) {
    focusInstructions += `
- Explain how each file fits into the broader system architecture
- Describe the purpose of the module/component and its relationships with other parts
- Highlight conventions and patterns specific to this codebase`;
  }
  if (hasLang) {
    focusInstructions += `
- Explain language-specific idioms, syntax, and features that may be unfamiliar
- Point out language best practices and common pitfalls
- When a pattern is language-specific, explain the underlying concept and alternatives`;
  }

  return `You are a JSON-only API. You output raw JSON with no other text, no markdown fences, no explanation.

TASK: Provide educational walkthrough notes for a code reviewer who is new to: ${topicList}.

Your goal is to help this reviewer understand the code changes by explaining concepts, patterns, and decisions they may not be familiar with. Focus on teaching — not evaluating risk or ordering files.

For each file, provide:
- "overview": A clear, educational explanation of what this file does, what changed, and why it matters. Tailor the depth to the reviewer's experience level.
- "lines": An array of specific line-level educational notes referencing NEW-side line numbers from the diff. Each entry has "line" (number) and "content" (educational explanation). Focus on the most instructive lines — not every line.

Focus areas:${focusInstructions}

General guidelines:
- Explain WHY something matters, not just WHAT it is
- Use concrete, accessible language — avoid jargon unless you define it
- When a change introduces a pattern, explain the pattern and its benefits
- Keep notes practical and specific to the actual code shown

OUTPUT FORMAT — you MUST output ONLY this JSON array, nothing else:
[{"filePath":"src/example.ts","notes":{"overview":"Educational summary of this file and its changes","lines":[{"line":42,"content":"This uses a closure to capture the variable — closures are functions that remember variables from their outer scope"}]}}]

If you need full file content to explain accurately, output ONLY: {"needContext":["path/to/file.ts"]}

CRITICAL: Your entire response must be parseable by JSON.parse(). No prose, no markdown, no explanation.`;
}

export const GuidedFileResultSchema = z.object({
  filePath: z.string(),
  notes: z.object({
    overview: z.string(),
    lines: z.array(z.object({ line: z.number(), content: z.string() })),
  }),
});
export type GuidedFileResult = z.infer<typeof GuidedFileResultSchema>;

/** Analyze a single batch of files for guided review educational content. */
export function runGuidedAnalysisBatch(
  files: ReviewFile[],
  config: AIConfig,
  repoRoot: string,
  guidedReview: GuidedReviewConfig,
): Promise<GuidedFileResult[]> {
  return runAnalysisBatch<GuidedFileResult>(files, config, repoRoot, {
    systemPrompt: buildSystemPrompt(guidedReview),
    initialPromptHeader: (n) => `Provide educational walkthrough notes for these ${String(n)} changed files:`,
    resultLabel: 'guided review notes',
    analysisName: 'Guided analysis',
    itemSchema: GuidedFileResultSchema,
  });
}
