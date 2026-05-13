import { serve } from '@hono/node-server';
import { existsSync,readFileSync } from 'fs';
import { Hono } from 'hono';
import { dirname,join } from 'path';
import { fileURLToPath } from 'url';

import { registerChannel } from './channel-config.js';
import { readGlobalConfig } from './global-config.js';
import { aiApiRoutes } from './routes/ai-api.js';
import { apiRoutes } from './routes/api.js';
import { channelApiRoutes } from './routes/channel-api.js';
import { pageRoutes } from './routes/pages.js';
import { themeApiRoutes } from './routes/theme-api.js';
import type { AppEnv } from './types.js';
import { openOS } from './utils/openOS.js';

function tryServe(appFetch: Hono<AppEnv>['fetch'], port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    // Cast needed: Hono's fetch Env param is typed as `object` but serve() expects `unknown`
    const server = serve({ fetch: appFetch as never, port, hostname: '127.0.0.1' });
    server.on('listening', () => { resolve(port); });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(err);
      } else {
        reject(err);
      }
    });
  });
}

export async function startServer(port: number, reviewId: string, repoRoot: string, options?: { noOpen?: boolean; strictPort?: boolean }) {
  const app = new Hono<AppEnv>();

  // Inject context
  app.use('*', async (c, next) => {
    c.set('reviewId', reviewId);
    c.set('currentReviewId', reviewId);
    c.set('repoRoot', repoRoot);
    await next();
  });

  // Static client assets — resolve from dist/client/ relative to the entry point
  // In production: import.meta.url is dist/cli.js -> dirname is dist/ -> client/ is correct
  // In dev: import.meta.url is src/server.ts -> dirname is src/ -> client/ won't have built files
  // So we check both locations
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const distDir = existsSync(join(selfDir, 'client', 'styles.css'))
    ? join(selfDir, 'client')
    : join(selfDir, '..', 'dist', 'client');
  app.get('/static/styles.css', (c) => {
    const css = readFileSync(join(distDir, 'styles.css'), 'utf-8');
    return c.text(css, 200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache' });
  });
  app.get('/static/app.js', (c) => {
    const js = readFileSync(join(distDir, 'app.global.js'), 'utf-8');
    return c.text(js, 200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' });
  });
  app.get('/static/history.js', (c) => {
    const js = readFileSync(join(distDir, 'history.global.js'), 'utf-8');
    return c.text(js, 200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' });
  });

  // API routes
  app.route('/api', apiRoutes);
  app.route('/api/ai', aiApiRoutes);
  app.route('/api/themes', themeApiRoutes);
  app.route('/api/channel', channelApiRoutes);

  // Page routes
  app.route('/', pageRoutes);

  let actualPort = port;
  if (options?.strictPort === true) {
    actualPort = await tryServe(app.fetch, port);
  } else {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        actualPort = await tryServe(app.fetch, port + attempt);
        break;
      } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'EADDRINUSE' && attempt < 19) {
          continue;
        }
        throw err;
      }
    }
  }

  if (actualPort !== port) {
    console.log(`  Port ${port} in use, using ${actualPort} instead.`);
  }

  const url = `http://localhost:${actualPort}`;
  console.log(`\n  Glassbox running at ${url}\n`);

  // Ensure .mcp.json is registered for this project if channel is enabled
  try {
    const globalConfig = readGlobalConfig();
    if (globalConfig.channelEnabled === true) {
      const dataDir = join(repoRoot, '.glassbox');
      registerChannel(dataDir);
    }
  } catch { /* non-critical */ }

  // Open browser (unless --no-open was passed)
  if (options?.noOpen !== true) {
    try { openOS(url, 'url'); } catch { /* best-effort */ }
  }
}
