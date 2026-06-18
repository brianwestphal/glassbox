/**
 * GB-894 — live model discovery. These tests mock `fetch` to pin the
 * per-provider response mapping and filtering, plus the failure → null contract
 * the route relies on to fall back to the static list. The real provider
 * responses can only be verified against live keys.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAvailableModels } from '../../../src/ai/list-models.js';

function mockFetch(payload: unknown, ok = true): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok,
    json: () => Promise.resolve(payload),
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchAvailableModels — Anthropic', () => {
  it('maps the /v1/models list to {id, name, contextWindow}', async () => {
    mockFetch({ data: [
      { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' },
      { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
    ] });
    const models = await fetchAvailableModels('anthropic', 'sk-test');
    expect(models).not.toBeNull();
    expect(models!.map(m => m.id)).toEqual(['claude-opus-4-8', 'claude-haiku-4-5']);
    expect(models!.find(m => m.id === 'claude-haiku-4-5')!.contextWindow).toBe(200000);
    expect(models!.find(m => m.id === 'claude-opus-4-8')!.contextWindow).toBe(1000000);
  });

  it('flags the current default model as isDefault when present', async () => {
    mockFetch({ data: [
      { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
    ] });
    const models = await fetchAvailableModels('anthropic', 'sk-test');
    const defaults = models!.filter(m => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe('claude-sonnet-4-6'); // the static default
  });

  it('returns null on a non-ok response (caller falls back to static)', async () => {
    mockFetch({}, false);
    expect(await fetchAvailableModels('anthropic', 'sk-test')).toBeNull();
  });

  it('returns null on an unexpected response shape', async () => {
    mockFetch({ unexpected: true });
    expect(await fetchAvailableModels('anthropic', 'sk-test')).toBeNull();
  });
});

describe('fetchAvailableModels — OpenAI', () => {
  it('filters the firehose down to chat models', async () => {
    mockFetch({ data: [
      { id: 'gpt-4o' },
      { id: 'o3-mini' },
      { id: 'chatgpt-4o-latest' },
      { id: 'text-embedding-3-large' },
      { id: 'whisper-1' },
      { id: 'dall-e-3' },
      { id: 'gpt-4o-mini-tts' },
      { id: 'gpt-3.5-turbo-instruct' },
    ] });
    const models = await fetchAvailableModels('openai', 'sk-test');
    const ids = models!.map(m => m.id);
    expect(ids).toContain('gpt-4o');
    expect(ids).toContain('o3-mini');
    expect(ids).toContain('chatgpt-4o-latest');
    expect(ids).not.toContain('text-embedding-3-large');
    expect(ids).not.toContain('whisper-1');
    expect(ids).not.toContain('dall-e-3');
    expect(ids).not.toContain('gpt-4o-mini-tts');
    expect(ids).not.toContain('gpt-3.5-turbo-instruct');
  });
});

describe('fetchAvailableModels — Local', () => {
  it('hits {baseUrl}/models and maps every id with no chat-filtering', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'llama3.1' }, { id: 'mistral' }, { id: 'nomic-embed-text' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchAvailableModels('local', '', { baseUrl: 'http://localhost:11434/v1' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/v1/models');
    // No firehose filtering — a local server lists only its installed models.
    expect(models!.map(m => m.id)).toEqual(['llama3.1', 'mistral', 'nomic-embed-text']);
    // The static default (llama3.1) is flagged when present.
    expect(models!.filter(m => m.isDefault).map(m => m.id)).toEqual(['llama3.1']);
  });

  it('returns null when the local server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    expect(await fetchAvailableModels('local', '', { baseUrl: 'http://localhost:11434/v1' })).toBeNull();
  });
});

describe('fetchAvailableModels — Google', () => {
  it('keeps generateContent models and strips the models/ prefix', async () => {
    mockFetch({ models: [
      { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
    ] });
    const models = await fetchAvailableModels('google', 'key');
    expect(models!.map(m => m.id)).toEqual(['gemini-2.5-pro']);
    expect(models![0].name).toBe('Gemini 2.5 Pro');
    expect(models![0].contextWindow).toBe(1048576);
  });
});

describe('fetchAvailableModels — failure handling', () => {
  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
    expect(await fetchAvailableModels('anthropic', 'sk-test')).toBeNull();
  });
});
