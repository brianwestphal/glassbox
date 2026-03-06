import { serve } from '@hono/node-server';
import { exec } from 'child_process';
import { existsSync,readFileSync } from 'fs';
import { Hono } from 'hono';
import { dirname,join } from 'path';
import { fileURLToPath } from 'url';

import { apiRoutes } from './routes/api.js';
import { pageRoutes } from './routes/pages.js';
import type { AppEnv } from './types.js';

function tryServe(fetch: Hono['fetch'], port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, port });
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

export async function startServer(port: number, reviewId: string, repoRoot: string) {
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

  // API routes
  app.route('/api', apiRoutes);

  // Page routes
  app.route('/', pageRoutes);

  let actualPort = port;
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

  if (actualPort !== port) {
    console.log(`  Port ${port} in use, using ${actualPort} instead.`);
  }

  const url = `http://localhost:${actualPort}`;
  console.log(`\n  Glassbox running at ${url}\n`);

  // Open browser
  const openCmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  exec(`${openCmd} ${url}`);
}
