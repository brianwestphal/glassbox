import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendAIRequest } from '../../../src/ai/client.js';
vi.mock('../../../src/debug.js', () => ({ debugLog: vi.fn() }));
vi.mock('../../../src/ai/apple-foundation.js', () => ({ runAppleFoundationInfer: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
const config = { platform: 'openai' as const, model: 'gpt-5.5-pro', apiKey: 'test-key', keySource: 'config' as const };
const completed = {
  status: 'completed', output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', content: [{ type: 'output_text', text: '{"ok":' }] },
    { type: 'message', content: [{ type: 'output_text', text: 'true}' }] },
  ], usage: { input_tokens: 15, output_tokens: 80 },
};

describe('GPT-5.5 Pro Responses API', () => {
  it.each(['gpt-5.5-pro', 'gpt-5.5-pro-2026-04-23'])('sends %s to Responses and combines text messages after reasoning', async model => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(completed)));
    const messages = [{ role: 'user' as const, content: 'review' }, { role: 'assistant' as const, content: 'previous answer' }, { role: 'user' as const, content: 'repair JSON' }];
    expect(await sendAIRequest({ ...config, model }, 'instructions', messages)).toEqual({ content: '{"ok":true}', inputTokens: 15, outputTokens: 80 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(String(options?.body))).toEqual({ model, instructions: 'instructions', input: messages, max_output_tokens: 8192, store: false });
  });

  it.each([
    [{ ...completed, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, /incomplete: max_output_tokens/],
    [{ status: 'failed', output: [], error: { message: 'Provider failed' } }, /failed: Provider failed/],
    [{ status: 'queued', output: [] }, /queued: no completed output/],
    [{ ...completed, output: [] }, /no text output/],
    [{ ...completed, output: [{ type: 'reasoning', summary: [] }] }, /no text output/],
    [{ ...completed, output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot analyze' }] }] }, /refused: Cannot analyze/],
  ])('rejects unfinished, empty and refused output', async (response, error) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response)));
    await expect(sendAIRequest(config, 'sys', [])).rejects.toThrow(error);
  });

  it('reports HTTP errors without retrying through another model or endpoint', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Rate limited', { status: 429 }));
    await expect(sendAIRequest(config, 'sys', [])).rejects.toThrow('OpenAI API error (429)');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
