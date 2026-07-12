/**
 * Integration test for the content-plugin branch of the image route
 * (`GET /api/image/:fileId/:side`, doc 29 GB-1052): a non-image file a plugin
 * renders to SVG is served as `image/svg+xml`, so the whole image viewer (zoom +
 * A/B/difference/side-by-side/slice) applies. Guards against regressing to the
 * old static-`<img>` plugin rendering.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { getModeString } from '../../../src/git/diff.js';
import { FileDiffSchema } from '../../../src/git/types.js';
import type { AppEnv } from '../../../src/types.js';

let rootA: string;
let rootB: string;
let reviewMode: string;

const file = {
  id: 'f1',
  review_id: 'r1',
  file_path: 'g.dot',
  status: 'modified',
  diff_data: JSON.stringify(FileDiffSchema.parse({ filePath: 'g.dot', status: 'modified', isBinary: false })),
  difference_score: null,
  created_at: new Date().toISOString(),
};

vi.mock('../../../src/db/queries.js', () => ({
  getReviewFile: (id: string) => Promise.resolve(id === 'f1' ? file : null),
  getReview: () => Promise.resolve({ id: 'r1', mode: reviewMode }),
}));
vi.mock('../../../src/db/connection.js', () => ({ getDataDir: () => '/tmp/gb-test-data' }));

import { __resetContentPluginsForTest, __setContentRegistryForTest } from '../../../src/plugins/index.js';
import { ContentPluginRegistry } from '../../../src/plugins/registry.js';
import { imageRoutes } from '../../../src/routes/api/image.js';

beforeAll(() => {
  rootA = mkdtempSync(join(tmpdir(), 'gb-imgA-'));
  rootB = mkdtempSync(join(tmpdir(), 'gb-imgB-'));
  writeFileSync(join(rootA, 'g.dot'), 'digraph { A -> B }');
  writeFileSync(join(rootB, 'g.dot'), 'digraph { A -> B -> C }');
  reviewMode = getModeString({ type: 'diff', pathA: rootA, pathB: rootB });
});
afterAll(() => {
  rmSync(rootA, { recursive: true, force: true });
  rmSync(rootB, { recursive: true, force: true });
});
afterEach(() => __resetContentPluginsForTest());

function appWithRenderer(svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>'): Hono<AppEnv> {
  const reg = new ContentPluginRegistry();
  reg.addRenderers([{ name: 'diagram', match: { extensions: ['.dot'] }, render: () => ({ svg }) }]);
  __setContentRegistryForTest(reg);
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('repoRoot', rootB); await next(); });
  app.route('/api', imageRoutes);
  return app;
}

describe('GET /api/image/:fileId/:side — plugin SVG (doc 29, GB-1052)', () => {
  it('serves the plugin-rendered SVG as image/svg+xml', async () => {
    const res = await appWithRenderer().request('/api/image/f1/new');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(await res.text()).toContain('<svg');
  });

  it('serves the old side too (for a modified file)', async () => {
    const res = await appWithRenderer().request('/api/image/f1/old');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
  });

  it('does NOT serve SVG when no plugin is registered (falls through to raw bytes)', async () => {
    __resetContentPluginsForTest();
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => { c.set('repoRoot', rootB); await next(); });
    app.route('/api', imageRoutes);
    const res = await app.request('/api/image/f1/new');
    // The plugin branch is skipped, so the `.dot` bytes are served with their
    // own (non-SVG) content-type — proving the SVG serving is plugin-driven.
    expect(res.headers.get('Content-Type')).not.toBe('image/svg+xml');
  });
});
