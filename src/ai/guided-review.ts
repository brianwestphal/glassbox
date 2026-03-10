import type { GuidedReviewConfig } from './config.js';

const TOPIC_DISPLAY: Record<string, string> = {
  programming: 'programming in general',
  codebase: 'this codebase',
  javascript: 'JavaScript',
  python: 'Python',
  typescript: 'TypeScript',
  java: 'Java',
  csharp: 'C#',
  cpp: 'C++',
  go: 'Go',
  rust: 'Rust',
  php: 'PHP',
  swift: 'Swift',
  ruby: 'Ruby',
  kotlin: 'Kotlin',
  scala: 'Scala',
  c: 'C',
  objectivec: 'Objective-C',
  r: 'R',
  lua: 'Lua',
  perl: 'Perl',
  bash: 'Shell scripting',
  dart: 'Dart',
  elixir: 'Elixir',
  erlang: 'Erlang',
  haskell: 'Haskell',
  clojure: 'Clojure',
  ocaml: 'OCaml',
  zig: 'Zig',
  nim: 'Nim',
  groovy: 'Groovy',
};

/** Top 10 languages shown by default in the settings UI. */
export const TOP_LANGUAGES: Array<[string, string]> = [
  ['javascript', 'JavaScript'],
  ['python', 'Python'],
  ['typescript', 'TypeScript'],
  ['java', 'Java'],
  ['csharp', 'C#'],
  ['cpp', 'C++'],
  ['go', 'Go'],
  ['rust', 'Rust'],
  ['php', 'PHP'],
  ['swift', 'Swift'],
];

/** Additional languages available under "More languages". */
export const MORE_LANGUAGES: Array<[string, string]> = [
  ['c', 'C'],
  ['ruby', 'Ruby'],
  ['kotlin', 'Kotlin'],
  ['scala', 'Scala'],
  ['dart', 'Dart'],
  ['objectivec', 'Objective-C'],
  ['elixir', 'Elixir'],
  ['haskell', 'Haskell'],
  ['clojure', 'Clojure'],
  ['bash', 'Shell'],
  ['perl', 'Perl'],
  ['lua', 'Lua'],
  ['r', 'R'],
  ['ocaml', 'OCaml'],
  ['zig', 'Zig'],
  ['nim', 'Nim'],
  ['erlang', 'Erlang'],
  ['groovy', 'Groovy'],
];

/**
 * Build a system prompt suffix for guided review mode.
 * Returns an empty string when guided review is disabled or has no topics.
 */
export function buildGuidedReviewSuffix(
  config: GuidedReviewConfig,
  analysisType: 'risk' | 'narrative',
): string {
  if (!config.enabled || config.topics.length === 0) return '';

  const topicNames = config.topics.map(t => TOPIC_DISPLAY[t] ?? t);
  const topicList = topicNames.join(', ');

  let suffix = `

GUIDED REVIEW MODE — The reviewer is new to: ${topicList}.

Adjust your output for this experience level:
- Write more detailed, educational explanations that help the reviewer learn
- Explain WHY something matters, not just WHAT it is
- When a concept relates to something the reviewer is learning, explain the underlying principle
- Include actionable suggestions for improvement, not just observations`;

  if (analysisType === 'risk') {
    suffix += `
- In rationale, provide context about why each risk dimension matters for this file
- In line-level notes, explain language idioms, design patterns, and security concepts the reviewer may not know
- Suggest specific fixes with brief code examples where helpful
- Be more verbose and explanatory than you would for an expert reviewer`;
  } else {
    suffix += `
- In overview notes, explain what the file does and its role in the broader system
- In line-level notes, explain patterns, conventions, and design decisions
- Help build understanding progressively through the reading order
- When relevant, explain how files relate to each other and why the ordering matters`;
  }

  return suffix;
}
