import { sendAIRequest } from '../../../src/ai/client.js';
import type { AIConfig } from '../../../src/ai/config.js';

vi.mock('../../../src/debug.js', () => ({
  debugLog: vi.fn(),
}));

function makeConfig(platform: 'anthropic' | 'openai' | 'google'): AIConfig {
  return { platform, model: 'test-model', apiKey: 'test-key', keySource: 'config' };
}

describe('sendAIRequest', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when no API key configured', async () => {
    const config: AIConfig = { platform: 'anthropic', model: 'test', apiKey: null, keySource: null };
    await expect(sendAIRequest(config, 'system', [{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('No API key configured');
  });

  describe('Anthropic', () => {
    it('sends request to Anthropic API and parses response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'text', text: 'Hello from Claude' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }), { status: 200 }));

      const result = await sendAIRequest(
        makeConfig('anthropic'),
        'system prompt',
        [{ role: 'user', content: 'test message' }],
      );

      expect(result.content).toBe('Hello from Claude');
      expect(result.inputTokens).toBe(10);
      expect(result.outputTokens).toBe(5);

      const call = fetchSpy.mock.calls[0];
      expect(call[0]).toBe('https://api.anthropic.com/v1/messages');
      const body = JSON.parse(call[1]!.body as string);
      expect(body.system).toBe('system prompt');
      expect(body.model).toBe('test-model');
    });

    it('throws on Anthropic API error', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Rate limited', { status: 429 }));
      await expect(sendAIRequest(makeConfig('anthropic'), 'sys', [{ role: 'user', content: 'x' }]))
        .rejects.toThrow('Anthropic API error (429)');
    });
  });

  describe('OpenAI', () => {
    it('sends request to OpenAI API and parses response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'Hello from GPT' } }],
        usage: { prompt_tokens: 15, completion_tokens: 8 },
      }), { status: 200 }));

      const result = await sendAIRequest(
        makeConfig('openai'),
        'system prompt',
        [{ role: 'user', content: 'test' }],
      );

      expect(result.content).toBe('Hello from GPT');
      expect(result.inputTokens).toBe(15);
      expect(result.outputTokens).toBe(8);

      const call = fetchSpy.mock.calls[0];
      expect(call[0]).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('throws on OpenAI API error', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Server error', { status: 500 }));
      await expect(sendAIRequest(makeConfig('openai'), 'sys', [{ role: 'user', content: 'x' }]))
        .rejects.toThrow('OpenAI API error (500)');
    });
  });

  describe('Google', () => {
    it('sends request to Google API and parses response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] } }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
      }), { status: 200 }));

      const result = await sendAIRequest(
        makeConfig('google'),
        'system prompt',
        [{ role: 'user', content: 'test' }],
      );

      expect(result.content).toBe('Hello from Gemini');
      expect(result.inputTokens).toBe(20);
      expect(result.outputTokens).toBe(10);

      const call = fetchSpy.mock.calls[0];
      expect((call[0] as string)).toContain('generativelanguage.googleapis.com');
      expect((call[0] as string)).toContain('key=test-key');
    });

    it('handles missing usageMetadata', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'response' }] } }],
      }), { status: 200 }));

      const result = await sendAIRequest(makeConfig('google'), 'sys', [{ role: 'user', content: 'x' }]);
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });

    it('throws on Google API error', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Bad request', { status: 400 }));
      await expect(sendAIRequest(makeConfig('google'), 'sys', [{ role: 'user', content: 'x' }]))
        .rejects.toThrow('Google AI API error (400)');
    });
  });
});
