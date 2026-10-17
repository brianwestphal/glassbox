import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterAll, expect, it, vi } from 'vitest';

// Exercise real persistence without reading the developer's keys or config.
vi.mock('../../../src/ai/api-keys.js', () => ({ resolveAPIKey: () => ({ key: null, source: null }) }));
vi.mock('../../../src/ai/apple-foundation.js', () => ({ isAppleFoundationAvailable: async () => true }));
const directory = mkdtempSync(join(tmpdir(), 'glassbox-model-preferences-'));
vi.stubEnv('GLASSBOX_CONFIG_DIR', directory);
const { aiConfigRoutes } = await import('../../../src/routes/ai-config.js');
const { loadAIConfig } = await import('../../../src/ai/config.js');
const app = new Hono().route('/api/ai', aiConfigRoutes);
afterAll(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

it('round-trips a model missing from the bundled catalog through settings and analysis', async () => {
  const saved = await app.request('/api/ai/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'openai', model: 'gpt-5.5-pro' }),
  });
  expect(saved.status).toBe(200);
  for (let reopen = 0; reopen < 2; reopen++) {
    const response = await app.request('/api/ai/config');
    expect(await response.json()).toMatchObject({ platform: 'openai', model: 'gpt-5.5-pro' });
  }
  expect(loadAIConfig()).toMatchObject({ platform: 'openai', model: 'gpt-5.5-pro' });
});

it('preserves the same model when selected as an Apple fallback', async () => {
  const saved = await app.request('/api/ai/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'apple', model: 'apple-on-device', fallbackPlatform: 'openai', fallbackModel: 'gpt-5.5-pro' }),
  });
  expect(saved.status).toBe(200);
  expect(loadAIConfig().fallback).toMatchObject({ platform: 'openai', model: 'gpt-5.5-pro' });
});
