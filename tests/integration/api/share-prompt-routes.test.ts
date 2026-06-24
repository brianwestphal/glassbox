/**
 * Integration tests for the share-prompt nudge endpoints in
 * `src/routes/api/share-prompt.ts` (doc 16). They read/mutate the
 * `sharePrompt` slice of the global config; we mock the config layer so no real
 * `~/.glassbox/config.json` is touched and assert the state/dismiss/tick
 * read-modify-write behavior plus body validation.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../../src/types.js';

// In-memory stand-in for the global config the route reads/writes.
let store: Record<string, unknown> = {};

const readGlobalConfigMock = vi.fn(() => store);
const updateGlobalConfigMock = vi.fn((mutator: (cfg: Record<string, unknown>) => Record<string, unknown> | void) => {
  const result = mutator(store);
  if (result !== undefined) store = result;
});

vi.mock('../../../src/global-config.js', () => ({
  readGlobalConfig: () => readGlobalConfigMock(),
  updateGlobalConfig: (m: (cfg: Record<string, unknown>) => Record<string, unknown> | void) => updateGlobalConfigMock(m),
}));

const { sharePromptRoutes } = await import('../../../src/routes/api/share-prompt.js');

function createTestApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/api', sharePromptRoutes);
  return app;
}

function get(path: string) {
  return createTestApp().request(`/api${path}`);
}

function post(path: string, body?: unknown) {
  return createTestApp().request(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  store = {};
  readGlobalConfigMock.mockClear();
  updateGlobalConfigMock.mockClear();
});

describe('GET /share-prompt/state', () => {
  it('returns defaults when nothing has been stored', async () => {
    const res = await get('/share-prompt/state');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dismissedAt: null, totalOpenMs: 0 });
  });

  it('returns the stored dismissedAt and totalOpenMs', async () => {
    store = { sharePrompt: { dismissedAt: 12345, totalOpenMs: 6789 } };
    const res = await get('/share-prompt/state');
    expect(await res.json()).toEqual({ dismissedAt: 12345, totalOpenMs: 6789 });
  });

  it('coerces a malformed sharePrompt blob back to defaults', async () => {
    store = { sharePrompt: 'not an object' };
    const res = await get('/share-prompt/state');
    expect(await res.json()).toEqual({ dismissedAt: null, totalOpenMs: 0 });
  });
});

describe('POST /share-prompt/dismiss', () => {
  it('records a dismissedAt timestamp and returns ok', async () => {
    const before = Date.now();
    const res = await post('/share-prompt/dismiss');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const sp = store.sharePrompt as { dismissedAt: number };
    expect(typeof sp.dismissedAt).toBe('number');
    expect(sp.dismissedAt).toBeGreaterThanOrEqual(before);
  });

  it('preserves an existing totalOpenMs when dismissing', async () => {
    store = { sharePrompt: { totalOpenMs: 555 } };
    await post('/share-prompt/dismiss');
    const sp = store.sharePrompt as { totalOpenMs: number; dismissedAt: number };
    expect(sp.totalOpenMs).toBe(555);
    expect(typeof sp.dismissedAt).toBe('number');
  });
});

describe('POST /share-prompt/tick', () => {
  it('accumulates session time onto the running total', async () => {
    store = { sharePrompt: { totalOpenMs: 1000 } };
    const res = await post('/share-prompt/tick', { sessionMs: 250 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ totalOpenMs: 1250 });
    expect((store.sharePrompt as { totalOpenMs: number }).totalOpenMs).toBe(1250);
  });

  it('starts from zero when no total is stored yet', async () => {
    const res = await post('/share-prompt/tick', { sessionMs: 400 });
    expect(await res.json()).toEqual({ totalOpenMs: 400 });
  });

  it('ignores a negative sessionMs (clamps the increment to zero)', async () => {
    store = { sharePrompt: { totalOpenMs: 800 } };
    const res = await post('/share-prompt/tick', { sessionMs: -100 });
    expect(await res.json()).toEqual({ totalOpenMs: 800 });
  });

  it('preserves dismissedAt while ticking', async () => {
    store = { sharePrompt: { dismissedAt: 42, totalOpenMs: 10 } };
    await post('/share-prompt/tick', { sessionMs: 5 });
    expect(store.sharePrompt).toEqual({ dismissedAt: 42, totalOpenMs: 15 });
  });

  it('returns 400 when sessionMs is missing', async () => {
    const res = await post('/share-prompt/tick', {});
    expect(res.status).toBe(400);
    expect(updateGlobalConfigMock).not.toHaveBeenCalled();
  });

  it('returns 400 when sessionMs is the wrong type', async () => {
    const res = await post('/share-prompt/tick', { sessionMs: 'lots' });
    expect(res.status).toBe(400);
  });
});
