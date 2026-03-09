import { debugLog } from '../debug.js';
import type { AIConfig } from './config.js';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export async function sendAIRequest(
  config: AIConfig,
  systemPrompt: string,
  messages: AIMessage[],
): Promise<AIResponse> {
  if (config.apiKey === null) {
    throw new Error(`No API key configured for ${config.platform}`);
  }

  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0) + systemPrompt.length;
  debugLog(`AI request → ${config.platform}/${config.model} | ${String(messages.length)} message(s) | ~${String(Math.ceil(totalChars / 3))} estimated tokens`);
  const start = Date.now();

  let response: AIResponse;
  switch (config.platform) {
    case 'anthropic':
      response = await sendAnthropicRequest(config.apiKey, config.model, systemPrompt, messages);
      break;
    case 'openai':
      response = await sendOpenAIRequest(config.apiKey, config.model, systemPrompt, messages);
      break;
    case 'google':
      response = await sendGoogleRequest(config.apiKey, config.model, systemPrompt, messages);
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
      max_tokens: 8192,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${String(response.status)}): ${errorText}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const text = data.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
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
    ...messages.map(m => ({ role: m.role as string, content: m.content })),
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
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${String(response.status)}): ${errorText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0].message.content,
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
  };
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
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google AI API error (${String(response.status)}): ${errorText}`);
  }

  const data = await response.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };

  const text = data.candidates[0].content.parts.map(p => p.text).join('');

  return {
    content: text,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}
