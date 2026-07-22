/**
 * The channel HTTP handler (doc 17 §17.4 / doc 14, GB-1080): POST /trigger
 * injects its body into an auto-executing Claude session, so it requires the
 * shared secret and sends no CORS headers — a browser page can neither read
 * the secret file nor survive the preflight the custom header forces.
 */
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChannelHandler } from '../../src/channel-server.js';

const SECRET = 'test-secret-0123456789abcdef';

let server: Server;
let base: string;
let notify: ReturnType<typeof vi.fn<(content: string) => Promise<void>>>;

beforeEach(async () => {
  notify = vi.fn<(content: string) => Promise<void>>(() => Promise.resolve());
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  server = createServer(createChannelHandler({ secret: SECRET, notify }));
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
});

describe('channel handler security (GB-1080)', () => {
  it('serves /health openly without any CORS headers', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-methods')).toBeNull();
  });

  it('rejects POST /trigger without the secret (the browser simple-request shape)', async () => {
    const res = await fetch(`${base}/trigger`, { method: 'POST', body: 'run this' });
    expect(res.status).toBe(403);
    expect(notify).not.toHaveBeenCalled();
  });

  it('rejects POST /trigger with a wrong secret', async () => {
    const res = await fetch(`${base}/trigger`, {
      method: 'POST',
      headers: { 'X-Glassbox-Secret': 'wrong' },
      body: 'run this',
    });
    expect(res.status).toBe(403);
    expect(notify).not.toHaveBeenCalled();
  });

  it('no longer answers CORS preflight (OPTIONS falls through to 404)', async () => {
    const res = await fetch(`${base}/trigger`, { method: 'OPTIONS' });
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('forwards the body to notify with the correct secret', async () => {
    const res = await fetch(`${base}/trigger`, {
      method: 'POST',
      headers: { 'X-Glassbox-Secret': SECRET },
      body: 'apply the review',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(notify).toHaveBeenCalledWith('apply the review');
  });

  it('substitutes the default instruction for an empty body', async () => {
    await fetch(`${base}/trigger`, { method: 'POST', headers: { 'X-Glassbox-Secret': SECRET } });
    expect(notify).toHaveBeenCalledWith('Read .glassbox/latest-review.md and apply the feedback.');
  });

  it('rejects an oversize body with 413 before notifying', async () => {
    const res = await fetch(`${base}/trigger`, {
      method: 'POST',
      headers: { 'X-Glassbox-Secret': SECRET },
      body: 'x'.repeat(1_100_000),
    });
    expect(res.status).toBe(413);
    expect(notify).not.toHaveBeenCalled();
  });

  it('returns 500 when notify throws', async () => {
    notify.mockRejectedValueOnce(new Error('mcp gone'));
    const res = await fetch(`${base}/trigger`, {
      method: 'POST',
      headers: { 'X-Glassbox-Secret': SECRET },
      body: 'x',
    });
    expect(res.status).toBe(500);
  });

  it('404s unknown routes', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
