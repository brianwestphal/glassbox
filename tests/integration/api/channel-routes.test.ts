/**
 * Integration tests for the channel API routes in `src/routes/channel-api.ts`.
 * Focus: input validation on `POST /trigger` and the surrounding lifecycle endpoints.
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../../src/types.js';

const TEST_REPO_ROOT = '/tmp/test-channel-repo';

vi.mock('../../../src/channel-config.js', () => ({
  isChannelAlive: vi.fn(async () => false),
  registerChannel: vi.fn(),
  unregisterChannel: vi.fn(),
  triggerChannel: vi.fn(async () => true),
}));

vi.mock('../../../src/global-config.js', () => ({
  readGlobalConfig: vi.fn(() => ({})),
  updateGlobalConfig: vi.fn(),
}));

import { channelApiRoutes } from '../../../src/routes/channel-api.js';

function createTestApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('reviewId', '');
    c.set('currentReviewId', '');
    c.set('repoRoot', TEST_REPO_ROOT);
    await next();
  });
  app.route('/api/channel', channelApiRoutes);
  return app;
}

describe('POST /api/channel/trigger', () => {
  it('returns 400 when message is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/api/channel/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('message must be a non-empty string');
  });

  it('returns 400 when message is an empty string', async () => {
    const app = createTestApp();
    const res = await app.request('/api/channel/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when message is whitespace-only', async () => {
    const app = createTestApp();
    const res = await app.request('/api/channel/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when message is not a string', async () => {
    const app = createTestApp();
    const res = await app.request('/api/channel/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 when message is a valid non-empty string and channel accepts', async () => {
    const app = createTestApp();
    const res = await app.request('/api/channel/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello claude' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
