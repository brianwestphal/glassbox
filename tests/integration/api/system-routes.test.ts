/**
 * Integration tests for the system API route in `src/routes/api/system.ts`.
 * Focus: input validation + the OS-open hand-off for `POST /open-external`.
 *
 * GB-808 — the Sponsor link is dead inside the Tauri webview (a `_blank`
 * anchor can't open a browser there), so the client routes the URL through
 * this endpoint, which shells out to the OS "open" handler via `openOS`. We
 * mock `openOS` so the test never actually launches a browser, and assert the
 * endpoint only forwards validated http(s) URLs.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../../src/types.js';

const openOSMock = vi.fn<(target: string, mode: 'url' | 'reveal') => void>();
vi.mock('../../../src/utils/openOS.js', () => ({
  openOS: (target: string, mode: 'url' | 'reveal') => openOSMock(target, mode),
}));

import { systemRoutes } from '../../../src/routes/api/system.js';

function createTestApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('reviewId', '');
    c.set('currentReviewId', '');
    c.set('repoRoot', '/tmp/test-repo');
    await next();
  });
  app.route('/api', systemRoutes);
  return app;
}

async function post(body: unknown) {
  return createTestApp().request('/api/open-external', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/open-external (GB-808)', () => {
  beforeEach(() => { openOSMock.mockReset(); });

  it('opens a valid https URL via openOS and returns ok', async () => {
    openOSMock.mockImplementation(() => {});
    const res = await post({ url: 'https://github.com/sponsors/brianwestphal' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(openOSMock).toHaveBeenCalledWith('https://github.com/sponsors/brianwestphal', 'url');
  });

  it('returns 400 when url is missing', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/url/);
    expect(openOSMock).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) scheme (no arbitrary OS open)', async () => {
    const res = await post({ url: 'file:///etc/passwd' });
    expect(res.status).toBe(400);
    expect(openOSMock).not.toHaveBeenCalled();
  });

  it('rejects a non-URL string', async () => {
    const res = await post({ url: 'not a url' });
    expect(res.status).toBe(400);
    expect(openOSMock).not.toHaveBeenCalled();
  });

  it('still returns ok if the OS open fails (best-effort)', async () => {
    openOSMock.mockImplementation(() => { throw new Error('no opener'); });
    const res = await post({ url: 'https://example.com' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
