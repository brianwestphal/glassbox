import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @hono/node-server before importing the module under test
const mockServer = {
  on: vi.fn((event: string, cb: () => void) => {
    if (event === 'listening') {
      // Call listening callback asynchronously to simulate server start
      setTimeout(cb, 0);
    }
  }),
};
vi.mock('@hono/node-server', () => ({
  serve: vi.fn(() => mockServer),
}));

// Mock child_process to prevent browser opening
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Mock fs for static file serving
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn((path: string) => {
      if (typeof path === 'string' && path.includes('styles.css')) return 'body { color: red; }';
      if (typeof path === 'string' && path.includes('app.global.js')) return 'console.log("app");';
      if (typeof path === 'string' && path.includes('history.global.js')) return 'console.log("history");';
      return '';
    }),
  };
});

// Mock route modules so they don't pull in database/AI dependencies
vi.mock('../../src/routes/api.js', () => {
  const { Hono } = require('hono');
  const routes = new Hono();
  routes.get('/ping', (c: any) => c.json({ ok: true }));
  return { apiRoutes: routes };
});

vi.mock('../../src/routes/ai-api.js', () => {
  const { Hono } = require('hono');
  const routes = new Hono();
  routes.get('/status', (c: any) => c.json({ ai: true }));
  return { aiApiRoutes: routes };
});

vi.mock('../../src/routes/pages.js', () => {
  const { Hono } = require('hono');
  const routes = new Hono();
  routes.get('/', (c: any) => c.text('Home page'));
  return { pageRoutes: routes };
});

import { startServer } from '../../src/server.js';
import { serve } from '@hono/node-server';
import { exec } from 'child_process';
import { existsSync, readFileSync } from 'fs';

describe('startServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock server's on handler for each test
    mockServer.on.mockImplementation((event: string, cb: () => void) => {
      if (event === 'listening') {
        setTimeout(cb, 0);
      }
    });
  });

  it('calls serve with the correct port and hostname', async () => {
    await startServer(4183, 'review-123', '/tmp/repo', { noOpen: true });

    expect(serve).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 4183,
        hostname: '127.0.0.1',
      })
    );
  });

  it('opens the browser by default', async () => {
    await startServer(4183, 'review-123', '/tmp/repo');

    expect(exec).toHaveBeenCalledWith(expect.stringContaining('http://localhost:4183'));
  });

  it('does not open the browser when noOpen is true', async () => {
    await startServer(4183, 'review-123', '/tmp/repo', { noOpen: true });

    expect(exec).not.toHaveBeenCalled();
  });

  it('serves styles.css with correct content type', async () => {
    await startServer(4183, 'review-123', '/tmp/repo', { noOpen: true });

    // Extract the Hono app from the serve call
    const serveCall = vi.mocked(serve).mock.calls[0][0];
    const fetchFn = serveCall.fetch as any;

    // Create a request to /static/styles.css
    const req = new Request('http://localhost:4183/static/styles.css');
    const res = await fetchFn(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/css');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    const body = await res.text();
    expect(body).toBe('body { color: red; }');
  });

  it('serves app.js with correct content type', async () => {
    await startServer(4183, 'review-123', '/tmp/repo', { noOpen: true });

    const serveCall = vi.mocked(serve).mock.calls[0][0];
    const fetchFn = serveCall.fetch as any;

    const req = new Request('http://localhost:4183/static/app.js');
    const res = await fetchFn(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/javascript');
    const body = await res.text();
    expect(body).toBe('console.log("app");');
  });

  it('serves history.js with correct content type', async () => {
    await startServer(4183, 'review-123', '/tmp/repo', { noOpen: true });

    const serveCall = vi.mocked(serve).mock.calls[0][0];
    const fetchFn = serveCall.fetch as any;

    const req = new Request('http://localhost:4183/static/history.js');
    const res = await fetchFn(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/javascript');
    const body = await res.text();
    expect(body).toBe('console.log("history");');
  });

  it('middleware sets reviewId and repoRoot context variables', async () => {
    await startServer(4183, 'review-abc', '/home/user/project', { noOpen: true });

    const serveCall = vi.mocked(serve).mock.calls[0][0];
    const fetchFn = serveCall.fetch as any;

    // Hit the mocked page route which goes through the middleware
    const req = new Request('http://localhost:4183/');
    const res = await fetchFn(req);
    // If the middleware didn't error, the route was reached
    expect(res.status).toBe(200);
  });

  it('routes /api/* to API routes', async () => {
    await startServer(4183, 'review-123', '/tmp/repo', { noOpen: true });

    const serveCall = vi.mocked(serve).mock.calls[0][0];
    const fetchFn = serveCall.fetch as any;

    const req = new Request('http://localhost:4183/api/ping');
    const res = await fetchFn(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('routes /api/ai/* to AI API routes', async () => {
    await startServer(4183, 'review-123', '/tmp/repo', { noOpen: true });

    const serveCall = vi.mocked(serve).mock.calls[0][0];
    const fetchFn = serveCall.fetch as any;

    const req = new Request('http://localhost:4183/api/ai/status');
    const res = await fetchFn(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ai: true });
  });

  it('falls back to dist/client/ when client dir does not exist next to entry', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);

    await startServer(4183, 'review-123', '/tmp/repo', { noOpen: true });

    // The server should still start and serve should be called
    expect(serve).toHaveBeenCalled();
  });

  it('tries next port when strictPort is false and port is in use', async () => {
    let callCount = 0;
    mockServer.on.mockImplementation((event: string, cb: (...args: any[]) => void) => {
      if (event === 'error' && callCount === 0) {
        // Simulate EADDRINUSE on first attempt
        const err = new Error('EADDRINUSE') as NodeJS.ErrnoException;
        err.code = 'EADDRINUSE';
        setTimeout(() => cb(err), 0);
      } else if (event === 'listening' && callCount > 0) {
        setTimeout(() => cb(), 0);
      }
    });

    // Need to handle the retry logic: first call fails, second succeeds
    vi.mocked(serve).mockImplementation(() => {
      callCount++;
      const server = {
        on: vi.fn((event: string, cb: (...args: any[]) => void) => {
          if (callCount === 1 && event === 'error') {
            const err = new Error('EADDRINUSE') as NodeJS.ErrnoException;
            err.code = 'EADDRINUSE';
            setTimeout(() => cb(err), 0);
          } else if (callCount > 1 && event === 'listening') {
            setTimeout(() => cb(), 0);
          }
        }),
      };
      return server as any;
    });

    await startServer(4183, 'review-123', '/tmp/repo', { noOpen: true });

    // serve should have been called more than once due to retry
    expect(vi.mocked(serve).mock.calls.length).toBeGreaterThan(1);
  });

  it('throws when strictPort is true and port is in use', async () => {
    vi.mocked(serve).mockImplementation(() => {
      const server = {
        on: vi.fn((event: string, cb: (...args: any[]) => void) => {
          if (event === 'error') {
            const err = new Error('EADDRINUSE') as NodeJS.ErrnoException;
            err.code = 'EADDRINUSE';
            setTimeout(() => cb(err), 0);
          }
        }),
      };
      return server as any;
    });

    await expect(
      startServer(4183, 'review-123', '/tmp/repo', { noOpen: true, strictPort: true })
    ).rejects.toThrow('EADDRINUSE');
  });
});
