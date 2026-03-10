import type { ReviewFile } from '../db/queries.js';
import { debugLog } from '../debug.js';
import type { GuidedFileResult } from './analyze-guided.js';
import type { NarrativeFileResult } from './analyze-narrative.js';
import type { RiskFileResult } from './analyze-risk.js';

const LOREM = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa.',
  'Nulla facilisi morbi tempus iaculis urna id volutpat lacus.',
  'Viverra accumsan in nisl nisi scelerisque eu ultrices vitae.',
  'Amet consectetur adipiscing elit pellentesque habitant morbi tristique.',
];

const LINE_NOTES = [
  'Consider extracting this into a helper function.',
  'This variable could use a more descriptive name.',
  'Potential null reference if upstream data is missing.',
  'Good use of early return pattern here.',
  'Magic number — consider defining as a named constant.',
  'This logic duplicates what exists in the utility module.',
  'Edge case: what happens when the input array is empty?',
  'Type assertion here bypasses compile-time safety checks.',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomScore(): number {
  return Math.round(Math.random() * 10) / 10;
}

function randomLines(count: number): Array<{ line: number; content: string }> {
  const lines: Array<{ line: number; content: string }> = [];
  const numLines = 1 + Math.floor(Math.random() * Math.min(count, 3));
  const usedLines = new Set<number>();
  for (let i = 0; i < numLines; i++) {
    let line = 1 + Math.floor(Math.random() * Math.max(count, 20));
    while (usedLines.has(line)) line++;
    usedLines.add(line);
    lines.push({ line, content: pick(LINE_NOTES) });
  }
  return lines.sort((a, b) => a.line - b.line);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

/** Mock risk analysis — returns random scores after a delay. */
export async function mockRiskAnalysisBatch(
  files: ReviewFile[],
): Promise<RiskFileResult[]> {
  const delay = 2000 + Math.random() * 2000; // 2-4 seconds
  debugLog(`[mock] Risk batch: ${String(files.length)} files, waiting ${String(Math.round(delay / 1000))}s`);
  await sleep(delay);

  return files.map(f => {
    const scores = {
      security: randomScore(),
      correctness: randomScore(),
      'error-handling': randomScore(),
      maintainability: randomScore(),
      architecture: randomScore(),
      performance: randomScore(),
    };
    const aggregate = Math.max(...Object.values(scores));
    return {
      filePath: f.file_path,
      scores,
      aggregate,
      rationale: pick(LOREM),
      notes: {
        overview: pick(LOREM),
        lines: randomLines(50),
      },
    };
  });
}

/** Mock narrative analysis — returns sequential positions after a delay. */
export async function mockNarrativeAnalysisBatch(
  files: ReviewFile[],
): Promise<NarrativeFileResult[]> {
  const delay = 2000 + Math.random() * 2000; // 2-4 seconds
  debugLog(`[mock] Narrative batch: ${String(files.length)} files, waiting ${String(Math.round(delay / 1000))}s`);
  await sleep(delay);

  // Shuffle files for a somewhat random reading order within the batch
  const shuffled = files.slice().sort(() => Math.random() - 0.5);

  return shuffled.map((f, idx) => ({
    filePath: f.file_path,
    position: idx + 1,
    rationale: pick(LOREM),
    notes: {
      overview: pick(LOREM),
      lines: randomLines(50),
    },
  }));
}

const GUIDED_NOTES = [
  'This is a closure — it captures variables from the surrounding scope so they can be used later.',
  'The async/await pattern makes asynchronous code read like synchronous code.',
  'This uses destructuring to extract specific properties from an object.',
  'A Set is used here because it automatically prevents duplicate entries.',
  'Template literals (backtick strings) allow embedding expressions with ${...} syntax.',
  'The optional chaining operator (?.) safely accesses nested properties that might be null.',
  'This arrow function uses an implicit return — no braces means the expression is returned directly.',
  'The spread operator (...) creates a shallow copy of the array to avoid mutating the original.',
];

/** Mock guided analysis — returns educational notes after a delay. */
export async function mockGuidedAnalysisBatch(
  files: ReviewFile[],
): Promise<GuidedFileResult[]> {
  const delay = 2000 + Math.random() * 2000; // 2-4 seconds
  debugLog(`[mock] Guided batch: ${String(files.length)} files, waiting ${String(Math.round(delay / 1000))}s`);
  await sleep(delay);

  return files.map(f => ({
    filePath: f.file_path,
    notes: {
      overview: pick(LOREM),
      lines: randomLines(50).map(l => ({ ...l, content: pick(GUIDED_NOTES) })),
    },
  }));
}
