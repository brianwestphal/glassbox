import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { exec } from 'child_process';
import type { AppEnv } from './types.js';
import { apiRoutes } from './routes/api.js';
import { pageRoutes } from './routes/pages.js';

export async function startServer(port: number, reviewId: string, repoRoot: string) {
  const app = new Hono<AppEnv>();

  // Inject context
  app.use('*', async (c, next) => {
    c.set('reviewId', reviewId);
    c.set('currentReviewId', reviewId);
    c.set('repoRoot', repoRoot);
    await next();
  });

  // API routes
  app.route('/api', apiRoutes);

  // Page routes
  app.route('/', pageRoutes);

  const url = `http://localhost:${port}`;
  console.log(`\n  Glassbox running at ${url}\n`);

  serve({ fetch: app.fetch, port });

  // Open browser
  const openCmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  exec(`${openCmd} ${url}`);
}
