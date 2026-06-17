import { z } from 'zod';

import type { AIModel, AIPlatform } from './models.js';
import { getDefaultModel } from './models.js';

/**
 * Live model discovery — fetch the list of currently-available models from each
 * provider's models API so the app isn't pinned to a hardcoded list that goes
 * stale when a snapshot is retired (GB-894). On any failure (no key, network
 * error, unexpected shape) the caller falls back to the static `MODELS` list.
 *
 * Keys never leave the server — this runs in the `/api/ai/models` route with
 * the resolved key, and only the mapped `{id, name, contextWindow}` is returned
 * to the client.
 */

const FETCH_TIMEOUT_MS = 8000;

/** GET with an abort timeout, returning parsed JSON or null on any failure. */
async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- Anthropic: GET /v1/models → { data: [{ id, display_name }] } ---------
const AnthropicListSchema = z.object({
  data: z.array(z.object({ id: z.string(), display_name: z.string().optional() })),
});

function anthropicContextWindow(id: string): number {
  // Display-only heuristic (batch planning uses the static lookup). Haiku-tier
  // is 200K; the current Opus/Sonnet/Fable tiers are 1M.
  return id.toLowerCase().includes('haiku') ? 200000 : 1000000;
}

async function fetchAnthropic(apiKey: string): Promise<AIModel[] | null> {
  const raw = await getJson('https://api.anthropic.com/v1/models?limit=1000', {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  });
  const parsed = AnthropicListSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.data.map(m => ({
    id: m.id,
    name: m.display_name ?? m.id,
    contextWindow: anthropicContextWindow(m.id),
    isDefault: false,
  }));
}

// --- OpenAI: GET /v1/models → { data: [{ id }] } (unfiltered firehose) -----
const OpenAIListSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});

/** Heuristic: keep chat/completion models, drop the non-chat firehose
 *  (embeddings, audio, image, moderation, …). OpenAI's list has no model
 *  metadata, so this is necessarily best-effort. */
function isOpenAIChatModel(id: string): boolean {
  const l = id.toLowerCase();
  const isChat = /^(gpt-|chatgpt-|o\d)/.test(l);
  const isNonChat = /(embedding|whisper|tts|audio|realtime|transcribe|moderation|dall-e|image|search|babbage|davinci|instruct)/.test(l);
  return isChat && !isNonChat;
}

async function fetchOpenAI(apiKey: string): Promise<AIModel[] | null> {
  const raw = await getJson('https://api.openai.com/v1/models', {
    Authorization: `Bearer ${apiKey}`,
  });
  const parsed = OpenAIListSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.data
    .filter(m => isOpenAIChatModel(m.id))
    .map(m => ({ id: m.id, name: m.id, contextWindow: 128000, isDefault: false }));
}

// --- Google: GET /v1beta/models → { models: [{ name, displayName, … }] } ---
const GoogleListSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
    displayName: z.string().optional(),
    inputTokenLimit: z.number().optional(),
    supportedGenerationMethods: z.array(z.string()).optional(),
  })),
});

async function fetchGoogle(apiKey: string): Promise<AIModel[] | null> {
  // Key goes in the query string per the Gemini REST API.
  const raw = await getJson(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`,
    {},
  );
  const parsed = GoogleListSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.models
    .filter(m => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map(m => ({
      id: m.name.replace(/^models\//, ''),
      name: m.displayName ?? m.name.replace(/^models\//, ''),
      contextWindow: m.inputTokenLimit !== undefined && m.inputTokenLimit > 0 ? m.inputTokenLimit : 1000000,
      isDefault: false,
    }));
}

/**
 * Fetch the live model list for a platform. Returns the mapped models, or
 * `null` if discovery failed (so the caller can fall back to the static list).
 * The current default model is flagged `isDefault` when present in the live
 * list, otherwise the first entry is — preserving the "exactly one default"
 * shape the dropdown expects.
 */
export async function fetchAvailableModels(platform: AIPlatform, apiKey: string): Promise<AIModel[] | null> {
  let models: AIModel[] | null;
  if (platform === 'anthropic') models = await fetchAnthropic(apiKey);
  else if (platform === 'openai') models = await fetchOpenAI(apiKey);
  else models = await fetchGoogle(apiKey);

  if (models === null || models.length === 0) return null;

  const defaultId = getDefaultModel(platform);
  const hasDefault = models.some(m => m.id === defaultId);
  return models.map((m, i) => ({
    ...m,
    isDefault: hasDefault ? m.id === defaultId : i === 0,
  }));
}
