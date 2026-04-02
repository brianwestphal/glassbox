import { mockGuidedAnalysisBatch, mockNarrativeAnalysisBatch, mockRiskAnalysisBatch } from '../../../src/ai/mock.js';
import type { ReviewFile } from '../../../src/db/queries.js';

const RISK_DIMENSIONS = ['security', 'correctness', 'error-handling', 'maintainability', 'architecture', 'performance'];

function makeFiles(count: number): ReviewFile[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `f${i}`, review_id: 'r1', file_path: `src/file${i}.ts`,
    status: 'pending', diff_data: null,
  }));
}

describe('mockRiskAnalysisBatch', () => {
  it('returns results for all input files', async () => {
    const files = makeFiles(3);
    const results = await mockRiskAnalysisBatch(files);
    expect(results).toHaveLength(3);
    expect(results.map(r => r.filePath)).toEqual(files.map(f => f.file_path));
  }, 10000);

  it('returns valid risk scores between 0 and 1', async () => {
    const results = await mockRiskAnalysisBatch(makeFiles(1));
    const r = results[0];
    for (const dim of RISK_DIMENSIONS) {
      expect(r.scores[dim as keyof typeof r.scores]).toBeGreaterThanOrEqual(0);
      expect(r.scores[dim as keyof typeof r.scores]).toBeLessThanOrEqual(1);
    }
  }, 10000);

  it('sets aggregate to max of dimension scores', async () => {
    const results = await mockRiskAnalysisBatch(makeFiles(1));
    const r = results[0];
    expect(r.aggregate).toBe(Math.max(...Object.values(r.scores)));
  }, 10000);

  it('includes rationale and notes with line references', async () => {
    const results = await mockRiskAnalysisBatch(makeFiles(1));
    const r = results[0];
    expect(typeof r.rationale).toBe('string');
    expect(r.rationale.length).toBeGreaterThan(0);
    expect(r.notes).toBeDefined();
    expect(typeof r.notes!.overview).toBe('string');
    expect(Array.isArray(r.notes!.lines)).toBe(true);
  }, 10000);
});

describe('mockNarrativeAnalysisBatch', () => {
  it('returns results for all input files with positions', async () => {
    const files = makeFiles(4);
    const results = await mockNarrativeAnalysisBatch(files);
    expect(results).toHaveLength(4);
    const positions = results.map(r => r.position).sort();
    expect(positions).toEqual([1, 2, 3, 4]);
  }, 10000);

  it('includes rationale and notes', async () => {
    const results = await mockNarrativeAnalysisBatch(makeFiles(1));
    expect(typeof results[0].rationale).toBe('string');
    expect(results[0].notes).toBeDefined();
  }, 10000);
});

describe('mockGuidedAnalysisBatch', () => {
  it('returns results for all input files', async () => {
    const files = makeFiles(2);
    const results = await mockGuidedAnalysisBatch(files);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.filePath)).toEqual(files.map(f => f.file_path));
  }, 10000);

  it('includes educational notes with lines', async () => {
    const results = await mockGuidedAnalysisBatch(makeFiles(1));
    const r = results[0];
    expect(r.notes).toBeDefined();
    expect(typeof r.notes.overview).toBe('string');
    expect(Array.isArray(r.notes.lines)).toBe(true);
    if (r.notes.lines.length > 0) {
      expect(typeof r.notes.lines[0].line).toBe('number');
      expect(typeof r.notes.lines[0].content).toBe('string');
    }
  }, 10000);
});
