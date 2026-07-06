import { serve, type ServerType } from '@hono/node-server';
import { existsSync,readFileSync } from 'fs';
import { Hono } from 'hono';
import { dirname,join } from 'path';
import { fileURLToPath } from 'url';

import { registerChannel } from './channel-config.js';
import { readGlobalConfig } from './global-config.js';
import { initContentPlugins } from './plugins/index.js';
import { aiApiRoutes } from './routes/ai-api.js';
import { apiRoutes } from './routes/api.js';
import { channelApiRoutes } from './routes/channel-api.js';
import { difftoolApiRoutes } from './routes/difftool-api.js';
import { pageRoutes } from './routes/pages.js';
import { themeApiRoutes } from './routes/theme-api.js';
import type { AppEnv } from './types.js';
import { openOS } from './utils/openOS.js';

/** How many consecutive ports to try (starting at the requested one) before
 *  giving up, when not in `--strict-port` mode. */
const MAX_PORT_ATTEMPTS = 20;

function tryServe(appFetch: Hono<AppEnv>['fetch'], port: number): Promise<{ port: number; server: ServerType }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: appFetch, port, hostname: '127.0.0.1' });
    server.on('listening', () => { resolve({ port, server }); });
    server.on('error', (err: NodeJS.ErrnoException) => { reject(err); });
  });
}

/**
 * Start the review server. Returns the live `server` handle and the port it
 * actually bound to (which may differ from `port` after the in-use fallback) —
 * the detached difftool session (doc 19) uses both to record its port and to
 * shut itself down on end-of-session.
 */
export async function startServer(port: number, reviewId: string, repoRoot: string, options?: { noOpen?: boolean; strictPort?: boolean; onComplete?: string | null }): Promise<{ port: number; server: ServerType }> {
  const app = new Hono<AppEnv>();
  const onCompleteCommand = options?.onComplete ?? null;

  // Inject context
  app.use('*', async (c, next) => {
    c.set('reviewId', reviewId);
    c.set('currentReviewId', reviewId);
    c.set('repoRoot', repoRoot);
    c.set('onCompleteCommand', onCompleteCommand);
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
  // The browser tab icon. The SVG is copied into dist/client/ at build time
  // (see tsup.config.ts / build:client / build-sidecar.sh) so it ships in both
  // the npm package and the Tauri sidecar, alongside styles.css and app.js.
  app.get('/favicon.svg', (c) => {
    const svg = readFileSync(join(distDir, 'favicon.svg'), 'utf-8');
    return c.body(svg, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
  });
  // Browsers that ignore the SVG <link> (and older ones) still auto-request
  // /favicon.ico. We don't ship a .ico, so answer 204 rather than let it 404 —
  // keeps the page console clean (and stops browsers that request it, e.g. full
  // Chrome, from tripping the e2e page-error guard).
  app.get('/favicon.ico', (c) => c.body(null, 204));

  // API routes
  app.route('/api', apiRoutes);
  app.route('/api/ai', aiApiRoutes);
  app.route('/api/themes', themeApiRoutes);
  app.route('/api/channel', channelApiRoutes);
  app.route('/api/difftool', difftoolApiRoutes);

  // Page routes
  app.route('/', pageRoutes);

  let actualPort = port;
  let server: ServerType | null = null;
  if (options?.strictPort === true) {
    ({ port: actualPort, server } = await tryServe(app.fetch, port));
  } else {
    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
      try {
        ({ port: actualPort, server } = await tryServe(app.fetch, port + attempt));
        break;
      } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS - 1) {
          continue;
        }
        throw err;
      }
    }
  }
  if (server === null) throw new Error(`Could not bind a port starting at ${port}`);

  if (actualPort !== port) {
    console.log(`  Port ${port} in use, using ${actualPort} instead.`);
  }

  const url = `http://localhost:${actualPort}`;
  console.log(`\n  Glassbox running at ${url}\n`);

  // Discover + load installed content plugins (doc 29). Fail-soft: never throws,
  // never blocks startup on a broken plugin.
  await initContentPlugins();

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

  return { port: actualPort, server };
}
