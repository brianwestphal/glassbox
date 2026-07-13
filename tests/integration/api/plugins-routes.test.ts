/**
 * Integration test for the content-plugin install error path (doc 29, GB-1048).
 * Installing a folder that isn't a plugin must return the plugin list **plus** an
 * `error` message (not a bare `{error}`), so the client's response validation
 * passes and the UI shows a clean message instead of a schema-validation failure.
 */
import { mkdtempSync, rmSync } from 'fs';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ListPluginsRespSchema } from '../../../src/api/plugins.js';
import { __resetContentPluginsForTest } from '../../../src/plugins/index.js';
import { pluginsRoutes } from '../../../src/routes/api/plugins.js';
import type { AppEnv } from '../../../src/types.js';

let repo: string;
let notAPlugin: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'gb-plugrepo-'));
  notAPlugin = mkdtempSync(join(tmpdir(), 'gb-notplugin-')); // empty dir, no manifest
  __resetContentPluginsForTest();
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(notAPlugin, { recursive: true, force: true });
});

function app(): Hono<AppEnv> {
  const a = new Hono<AppEnv>();
  a.use('*', async (c, next) => { c.set('repoRoot', repo); await next(); });
  a.route('/api', pluginsRoutes);
  return a;
}

describe('POST /api/plugins/install — error shape (GB-1048)', () => {
  it('returns the plugin list + a clean error for a non-plugin folder', async () => {
    const res = await app().request('/api/plugins/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: notAPlugin }),
    });
    expect(res.status).toBe(400);
    const body: unknown = await res.json();
    // The body validates against the list schema (so the client doesn't throw a
    // schema-validation error) AND carries a human message.
    const parsed = ListPluginsRespSchema.parse(body);
    expect(parsed.plugins).toEqual([]);
    expect(parsed.error).toMatch(/manifest\.json/);
  });
});
