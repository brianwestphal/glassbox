vi.mock('../../../src/ai/client.js', () => ({
  sendAIRequest: vi.fn(),
}));
vi.mock('../../../src/git/diff.js', () => ({
  getFileContent: vi.fn().mockReturnValue('file content'),
}));

import { sendAIRequest } from '../../../src/ai/client.js';
import { runGuidedAnalysisBatch } from '../../../src/ai/analyze-guided.js';
import type { ReviewFile } from '../../../src/db/queries.js';

const mockConfig = { platform: 'anthropic' as const, model: 'claude-sonnet-4-6', apiKey: 'test-key' };
const guidedConfig = { enabled: true, topics: ['typescript', 'codebase'] as string[] };

function makeFiles(n: number): ReviewFile[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`, review_id: 'r1', file_path: `src/file${i}.ts`,
    status: 'pending', diff_data: JSON.stringify({ filePath: `src/file${i}.ts`, hunks: [], status: 'modified', isBinary: false, oldPath: null }),
  }));
}

const validResult = [
  { filePath: 'src/file0.ts', notes: { overview: 'This file does X', lines: [{ line: 5, content: 'Uses destructuring' }] } },
];

describe('runGuidedAnalysisBatch', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns guided results on success', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify(validResult) });
    const results = await runGuidedAnalysisBatch(makeFiles(1), mockConfig, '/repo', guidedConfig);
    expect(results).toHaveLength(1);
    expect(results[0].notes.overview).toBe('This file does X');
  });

  it('builds system prompt with topic-specific instructions', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify(validResult) });
    await runGuidedAnalysisBatch(makeFiles(1), mockConfig, '/repo', guidedConfig);
    const systemPrompt = vi.mocked(sendAIRequest).mock.calls[0][1];
    expect(systemPrompt).toContain('TypeScript');
    expect(systemPrompt).toContain('codebase');
    expect(systemPrompt).toContain('educational');
  });

  it('includes programming focus for programming topic', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify(validResult) });
    await runGuidedAnalysisBatch(makeFiles(1), mockConfig, '/repo',
      { enabled: true, topics: ['programming'] });
    const systemPrompt = vi.mocked(sendAIRequest).mock.calls[0][1];
    expect(systemPrompt).toContain('basic programming concepts');
  });

  it('handles NeedContext response', async () => {
    vi.mocked(sendAIRequest)
      .mockResolvedValueOnce({ content: JSON.stringify({ needContext: ['src/file0.ts'] }) })
      .mockResolvedValueOnce({ content: JSON.stringify(validResult) });
    const results = await runGuidedAnalysisBatch(makeFiles(1), mockConfig, '/repo', guidedConfig);
    expect(results).toHaveLength(1);
    expect(sendAIRequest).toHaveBeenCalledTimes(2);
  });

  it('throws on unknown context request', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify({ needContext: ['nope.ts'] }) });
    await expect(runGuidedAnalysisBatch(makeFiles(1), mockConfig, '/repo', guidedConfig))
      .rejects.toThrow('not in the review');
  });

  it('throws on non-array result', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: '{"invalid": true}' });
    await expect(runGuidedAnalysisBatch(makeFiles(1), mockConfig, '/repo', guidedConfig))
      .rejects.toThrow('Expected an array');
  });

  it('throws after 3 rounds without convergence', async () => {
    vi.mocked(sendAIRequest).mockResolvedValue({ content: JSON.stringify({ needContext: ['src/file0.ts'] }) });
    await expect(runGuidedAnalysisBatch(makeFiles(1), mockConfig, '/repo', guidedConfig))
      .rejects.toThrow('did not converge');
  });
});
