vi.mock('../../../src/ai/client.js', () => ({
  sendAIRequest: vi.fn(),
}));
vi.mock('../../../src/git/diff.js', () => ({
  getFileContent: vi.fn().mockReturnValue('file content'),
}));

import { sendAIRequest } from '../../../src/ai/client.js';
import { runNarrativeAnalysisBatch, mergeNarrativeOrders } from '../../../src/ai/analyze-narrative.js';
import type { NarrativeFileResult } from '../../../src/ai/analyze-narrative.js';
import type { ReviewFile } from '../../../src/db/queries.js';

const mockConfig = { platform: 'anthropic' as const, model: 'claude-sonnet-4-6', apiKey: 'test-key' };

function makeFiles(n: number): ReviewFile[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`, review_id: 'r1', file_path: `src/file${i}.ts`,
    status: 'pending', diff_data: JSON.stringify({ filePath: `src/file${i}.ts`, hunks: [], status: 'modified', isBinary: false, oldPath: null }),
  }));
}

const validResult = [
  { filePath: 'src/file0.ts', position: 1, rationale: 'Start here' },
  { filePath: 'src/file1.ts', position: 2, rationale: 'Then this' },
];

describe('runNarrativeAnalysisBatch', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns narrative results on success', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify(validResult) });
    const results = await runNarrativeAnalysisBatch(makeFiles(2), mockConfig, '/repo');
    expect(results).toHaveLength(2);
    expect(results[0].position).toBe(1);
  });

  it('handles NeedContext with follow-up', async () => {
    vi.mocked(sendAIRequest)
      .mockResolvedValueOnce({ content: JSON.stringify({ needContext: ['src/file0.ts'] }) })
      .mockResolvedValueOnce({ content: JSON.stringify(validResult) });
    const results = await runNarrativeAnalysisBatch(makeFiles(2), mockConfig, '/repo');
    expect(results).toHaveLength(2);
    expect(sendAIRequest).toHaveBeenCalledTimes(2);
  });

  it('throws if AI requests unknown files', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify({ needContext: ['nope.ts'] }) });
    await expect(runNarrativeAnalysisBatch(makeFiles(1), mockConfig, '/repo'))
      .rejects.toThrow('not in the review');
  });

  it('accepts a single object result for a single-file batch (GB-915)', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify(validResult[0]) });
    const results = await runNarrativeAnalysisBatch(makeFiles(1), mockConfig, '/repo');
    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe('src/file0.ts');
  });

  it('throws on a result matching no schema (object or array)', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify({ bad: true }) });
    await expect(runNarrativeAnalysisBatch(makeFiles(1), mockConfig, '/repo'))
      .rejects.toThrow('Expected an array');
  });

  it('throws after 3 rounds without convergence', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify({ needContext: ['src/file0.ts'] }) });
    await expect(runNarrativeAnalysisBatch(makeFiles(1), mockConfig, '/repo'))
      .rejects.toThrow('did not converge');
  });
});

describe('mergeNarrativeOrders', () => {
  it('returns positions as-is for single batch', () => {
    const results: NarrativeFileResult[] = [
      { filePath: 'a.ts', position: 1, rationale: '' },
      { filePath: 'b.ts', position: 2, rationale: '' },
    ];
    const merged = mergeNarrativeOrders(results, 1);
    expect(merged.get('a.ts')).toBe(1);
    expect(merged.get('b.ts')).toBe(2);
  });

  it('interleaves multiple batches round-robin', () => {
    const results: NarrativeFileResult[] = [
      // Batch 1
      { filePath: 'a.ts', position: 1, rationale: '' },
      { filePath: 'b.ts', position: 2, rationale: '' },
      // Batch 2 (position resets)
      { filePath: 'c.ts', position: 1, rationale: '' },
      { filePath: 'd.ts', position: 2, rationale: '' },
    ];
    const merged = mergeNarrativeOrders(results, 2);
    // Round-robin: a(1), c(2), b(3), d(4)
    expect(merged.get('a.ts')).toBe(1);
    expect(merged.get('c.ts')).toBe(2);
    expect(merged.get('b.ts')).toBe(3);
    expect(merged.get('d.ts')).toBe(4);
  });

  it('handles uneven batch sizes', () => {
    const results: NarrativeFileResult[] = [
      { filePath: 'a.ts', position: 1, rationale: '' },
      { filePath: 'b.ts', position: 2, rationale: '' },
      { filePath: 'c.ts', position: 3, rationale: '' },
      // Batch 2
      { filePath: 'd.ts', position: 1, rationale: '' },
    ];
    const merged = mergeNarrativeOrders(results, 2);
    expect(merged.size).toBe(4);
  });
});

