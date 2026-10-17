import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { runGuidedAnalysisBatch } from '../../../src/ai/analyze-guided.js';

const directory = mkdtempSync(join(tmpdir(), 'glassbox-pro-analysis-'));
execFileSync('git', ['init', '-q'], { cwd: directory });
writeFileSync(join(directory, 'example.ts'), 'export const answer = 42;\n');
afterAll(() => { vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }); });

it('runs a guided review through Responses, including a full-file context follow-up', async () => {
  const result = [{ filePath: 'example.ts', notes: { overview: 'Exports an answer.', lines: [{ line: 1, content: 'A named export.' }] } }];
  const response = (body: unknown) => new Response(JSON.stringify({ status: 'completed',
    output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(body) }] }],
    usage: { input_tokens: 100, output_tokens: 40 },
  }));
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(response({ needContext: ['example.ts'] }))
    .mockResolvedValueOnce(response(result));
  const actual = await runGuidedAnalysisBatch([{ id: 'file', review_id: 'review', file_path: 'example.ts', status: 'pending',
    diff_data: JSON.stringify({ filePath: 'example.ts', oldPath: null, status: 'modified', isBinary: false, hunks: [] }),
  }], { platform: 'openai', model: 'gpt-5.5-pro', apiKey: 'test-key', keySource: 'config' }, directory, { enabled: true, topics: ['typescript'] });
  expect(actual).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url, options] of fetch.mock.calls) {
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe('gpt-5.5-pro');
    expect(body.instructions).toContain('TypeScript');
    expect(body.store).toBe(false);
  }
  const followUp = JSON.parse(String(fetch.mock.calls[1][1]?.body));
  expect(followUp.input.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant', 'user']);
  expect(followUp.input[2].content).toContain('export const answer = 42');
});
