vi.mock('../../../src/ai/client.js', () => ({
  sendAIRequest: vi.fn(),
}));
vi.mock('../../../src/git/diff.js', () => ({
  getFileContent: vi.fn().mockReturnValue('file content'),
}));

import { sendAIRequest } from '../../../src/ai/client.js';
import { runRiskAnalysisBatch, RISK_DIMENSIONS } from '../../../src/ai/analyze-risk.js';
import type { ReviewFile } from '../../../src/db/queries.js';

const mockConfig = { platform: 'anthropic' as const, model: 'claude-sonnet-4-6', apiKey: 'test-key' };

function makeFiles(n: number): ReviewFile[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`, review_id: 'r1', file_path: `src/file${i}.ts`,
    status: 'pending', diff_data: JSON.stringify({ filePath: `src/file${i}.ts`, hunks: [], status: 'modified', isBinary: false, oldPath: null }),
  }));
}

const validResult = [
  { filePath: 'src/file0.ts', scores: { security: 0.1, correctness: 0.5, 'error-handling': 0.2, maintainability: 0.3, architecture: 0.1, performance: 0.2 }, aggregate: 0.5, rationale: 'Some concern' },
];

describe('runRiskAnalysisBatch', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns risk results on successful AI response', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify(validResult) });
    const results = await runRiskAnalysisBatch(makeFiles(1), mockConfig, '/repo');
    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe('src/file0.ts');
    expect(results[0].aggregate).toBe(0.5);
  });

  it('handles NeedContext response with follow-up round', async () => {
    vi.mocked(sendAIRequest)
      .mockResolvedValueOnce({ content: JSON.stringify({ needContext: ['src/file0.ts'] }) })
      .mockResolvedValueOnce({ content: JSON.stringify(validResult) });
    const results = await runRiskAnalysisBatch(makeFiles(1), mockConfig, '/repo');
    expect(results).toHaveLength(1);
    expect(sendAIRequest).toHaveBeenCalledTimes(2);
  });

  it('throws if AI requests context for files not in review', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify({ needContext: ['unknown.ts'] }) });
    await expect(runRiskAnalysisBatch(makeFiles(1), mockConfig, '/repo'))
      .rejects.toThrow('not in the review');
  });

  it('accepts a single object result for a single-file batch (GB-915)', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify(validResult[0]) });
    const results = await runRiskAnalysisBatch(makeFiles(1), mockConfig, '/repo');
    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe('src/file0.ts');
  });

  it('throws if AI returns a result matching no schema (object or array)', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify({ invalid: true }) });
    await expect(runRiskAnalysisBatch(makeFiles(1), mockConfig, '/repo'))
      .rejects.toThrow('Expected an array');
  });

  it('throws after 3 context rounds without convergence', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify({ needContext: ['src/file0.ts'] }) });
    await expect(runRiskAnalysisBatch(makeFiles(1), mockConfig, '/repo'))
      .rejects.toThrow('did not converge');
  });

  it('passes guided review config to system prompt when provided', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify(validResult) });
    await runRiskAnalysisBatch(makeFiles(1), mockConfig, '/repo', { enabled: true, topics: ['typescript'] });
    const systemPrompt = vi.mocked(sendAIRequest).mock.calls[0][1];
    expect(systemPrompt).toContain('TypeScript');
  });
});

describe('RISK_DIMENSIONS', () => {
  it('has 6 dimensions', () => {
    expect(RISK_DIMENSIONS).toHaveLength(6);
    expect(RISK_DIMENSIONS).toContain('security');
    expect(RISK_DIMENSIONS).toContain('performance');
  });
});

