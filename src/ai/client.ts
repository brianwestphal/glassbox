import { z } from 'zod';

import { debugLog } from '../debug.js';
import { runAppleFoundationInfer } from './apple-foundation.js';
import type { AIConfig } from './config.js';
import { DEFAULT_LOCAL_ENDPOINT } from './config.js';
import { KEYLESS_PLATFORMS } from './models.js';
import { CHARS_PER_TOKEN } from './token-budget.js';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

/** Max completion tokens requested from every HTTP provider. */
const MAX_OUTPUT_TOKENS = 8192;

/** Throw a uniform, label-prefixed error when a provider response isn't OK. */
async function throwIfNotOk(response: Response, label: string): Promise<void> {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${label} (${String(response.status)}): ${errorText}`);
  }
}

// --- Response schemas for the three upstream APIs ---
// Each shape is a minimal projection of what we actually consume — the
// vendors return more fields than this, but `.loose()` lets the parser
// ignore them. The schemas exist so a vendor-side breaking change shows
// up as a clear validation error rather than `undefined.text`.

const AnthropicResponseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).loose(),
}).loose();

const OpenAIResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }).loose(),
  }).loose()).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).loose(),
}).loose();

// Local OpenAI-compatible servers (Ollama, LM Studio, …) follow the OpenAI
// shape but don't always return `usage` — keep it optional so a missing token
// count degrades to 0 rather than failing the parse.
const LocalResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }).loose(),
  }).loose()).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).loose().optional(),
}).loose();

const GoogleResponseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({ text: z.string() }).loose()),
    }).loose(),
  }).loose()).min(1),
  usageMetadata: z.object({
    promptTokenCount: z.number(),
    candidatesTokenCount: z.number(),
  }).loose().optional(),
}).loose();

/** Cloud platforms require a key; throws with a clear message if absent.
 *  Keyless platforms (local) never call this. */
function requireKey(config: AIConfig): string {
  if (config.apiKey === null) {
    throw new Error(`No API key configured for ${config.platform}`);
  }
  return config.apiKey;
}

export async function sendAIRequest(
  config: AIConfig,
  systemPrompt: string,
  messages: AIMessage[],
): Promise<AIResponse> {
  if (config.apiKey === null && !KEYLESS_PLATFORMS.has(config.platform)) {
    throw new Error(`No API key configured for ${config.platform}`);
  }

  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0) + systemPrompt.length;
  debugLog(`AI request → ${config.platform}/${config.model} | ${String(messages.length)} message(s) | ~${String(Math.ceil(totalChars / CHARS_PER_TOKEN))} estimated tokens`);
  const start = Date.now();

  let response: AIResponse;
  switch (config.platform) {
    case 'anthropic':
      response = await sendAnthropicRequest(requireKey(config), config.model, systemPrompt, messages);
      break;
    case 'openai':
      response = await sendOpenAIRequest(requireKey(config), config.model, systemPrompt, messages);
      break;
    case 'google':
      response = await sendGoogleRequest(requireKey(config), config.model, systemPrompt, messages);
      break;
    case 'local':
      response = await sendLocalRequest(config.baseUrl ?? DEFAULT_LOCAL_ENDPOINT, config.apiKey, config.model, systemPrompt, messages);
      break;
    case 'apple':
      response = await sendAppleRequest(systemPrompt, messages);
      break;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  debugLog(`AI response ← ${elapsed}s | ${String(response.inputTokens)} in / ${String(response.outputTokens)} out tokens`);
  return response;
}

async function sendAnthropicRequest(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AIMessage[],
): Promise<AIResponse> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  await throwIfNotOk(response, 'Anthropic API error');

  const raw: unknown = await response.json();
  const data = AnthropicResponseSchema.parse(raw);

  const text = data.content
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('');

  return {
    content: text,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
  };
}

async function sendOpenAIRequest(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AIMessage[],
): Promise<AIResponse> {
  const oaiMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: oaiMessages,
      max_tokens: MAX_OUTPUT_TOKENS,
    }),
  });

  await throwIfNotOk(response, 'OpenAI API error');

  const raw: unknown = await response.json();
  const data = OpenAIResponseSchema.parse(raw);

  return {
    content: data.choices[0].message.content,
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
  };
}

/**
 * Local OpenAI-compatible server (Ollama / LM Studio / any `/v1`-style
 * endpoint). Same request body as OpenAI, but against a configurable base URL
 * and with `Authorization` only when a key is configured (Ollama needs none).
 */
async function sendLocalRequest(
  baseUrl: string,
  apiKey: string | null,
  model: string,
  systemPrompt: string,
  messages: AIMessage[],
): Promise<AIResponse> {
  const oaiMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey !== null && apiKey !== '') headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages: oaiMessages, max_tokens: MAX_OUTPUT_TOKENS, stream: false }),
  });

  await throwIfNotOk(response, 'Local model error');

  const raw: unknown = await response.json();
  const data = LocalResponseSchema.parse(raw);

  return {
    content: data.choices[0].message.content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

/**
 * On-device Apple Foundation Models (macOS 26+). Reached not over HTTP but
 * through the `apple-fm` package (`src/ai/apple-foundation.ts`), whose bundled
 * Swift helper runs the native `FoundationModels` API. Keyless; it returns the
 * model's raw text, which the analysis layer parses with `extractJSON` like any
 * other provider. The on-device API reports no token usage, so counts are 0.
 */
async function sendAppleRequest(
  systemPrompt: string,
  messages: AIMessage[],
): Promise<AIResponse> {
  const content = await runAppleFoundationInfer(systemPrompt, messages);
  return { content, inputTokens: 0, outputTokens: 0 };
}

async function sendGoogleRequest(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: AIMessage[],
): Promise<AIResponse> {
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: 'application/json',
        },
      }),
    },
  );

  await throwIfNotOk(response, 'Google AI API error');

  const raw: unknown = await response.json();
  const data = GoogleResponseSchema.parse(raw);

  const text = data.candidates[0].content.parts.map(p => p.text).join('');

  return {
    content: text,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}
