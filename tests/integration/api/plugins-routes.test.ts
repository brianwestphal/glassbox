/**
 * Integration test for the content-plugin install error path (doc 29, GB-1048).
 * Installing a folder that isn't a plugin must return the plugin list **plus** an
 * `error` message (not a bare `{error}`), so the client's response validation
 * passes and the UI shows a clean message instead of a schema-validation failure.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ListPluginsRespSchema, ListPluginUiRespSchema, RunPluginActionRespSchema } from '../../../src/api/plugins.js';
import { __resetContentPluginsForTest, __setContentRegistryForTest } from '../../../src/plugins/index.js';
import { clearConfigLabelOverrides, loadAllPlugins } from '../../../src/plugins/loader.js';
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

describe('slug guard on /api/plugins/:id (doc 14, GB-1081)', () => {
  // Hono percent-decodes path params, so without the slug guard an encoded
  // `..%2F..%2F<dir>` id reaches uninstallPlugin's recursive rmSync and
  // escapes the plugins dir. The guard must reject BEFORE any fs work: prove
  // it by pointing the traversal at a real directory and asserting it survives.
  it('DELETE with an encoded traversal id returns 400 and deletes nothing', async () => {
    const victim = mkdtempSync(join(tmpdir(), 'gb-victim-'));
    writeFileSync(join(victim, 'keep.txt'), 'still here');
    try {
      const id = encodeURIComponent(`../../${victim.split('/').filter(Boolean).join('/')}`);
      const res = await app().request(`/api/plugins/${id}`, { method: 'DELETE' });
      expect(res.status).toBe(400);
      expect(readFileSync(join(victim, 'keep.txt'), 'utf-8')).toBe('still here');
    } finally {
      rmSync(victim, { recursive: true, force: true });
    }
  });

  it('rejects traversal / separator / leading-dot ids on every :id route', async () => {
    // A literal `..` segment is URL-normalized away before routing (404s);
    // everything else must be caught by the slug guard (400). Either status
    // means the id never reached the filesystem.
    for (const bad of ['..', '.hidden', encodeURIComponent('a/b'), encodeURIComponent('..\\x')]) {
      for (const [method, path] of [
        ['DELETE', `/api/plugins/${bad}`],
        ['POST', `/api/plugins/${bad}/disabled`],
        ['POST', `/api/plugins/${bad}/install-bundled`],
      ] as const) {
        const res = await app().request(path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: method === 'POST' ? JSON.stringify({ scope: 'global', disabled: true }) : undefined,
        });
        expect([400, 404], `${method} ${path} -> ${String(res.status)}`).toContain(res.status);
      }
    }
  });
});

describe('POST /api/plugins/:id/action — config-layout button (doc 29 FR-29.18)', () => {
  // A real plugin whose onAction drives a config-layout status label. Loaded
  // through the real loader so onAction runs against the real override map that
  // describeInstalledPlugins reads back.
  async function loadActionPlugin(): Promise<void> {
    const pluginsRoot = mkdtempSync(join(tmpdir(), 'gb-actplugins-'));
    const dir = join(pluginsRoot, 'act-plugin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      id: 'act-plugin', name: 'Action Plugin', version: '1.0.0',
      configLayout: [{ type: 'label', id: 'status', text: 'Not tested', color: 'transient' }],
    }));
    writeFileSync(join(dir, 'index.js'), `export default {
      activate(ctx) {
        ctx.registerUI([{ type: 'button', id: 'act-btn', location: 'diff-toolbar', label: 'Act', action: 'ok' }]);
        return {};
      },
      onAction(actionId, ctx) {
        if (actionId === 'ok') { ctx.updateConfigLabel('status', 'Connected', 'success'); return { message: 'done' }; }
      },
    };`);
    clearConfigLabelOverrides('act-plugin');
    const { registry, loaded } = await loadAllPlugins(pluginsRoot, undefined, repo);
    __setContentRegistryForTest(registry, loaded);
    rmSync(pluginsRoot, { recursive: true, force: true });
  }

  it('runs the action and reflects the updated dynamic label + returns the result message', async () => {
    await loadActionPlugin();
    const res = await app().request('/api/plugins/act-plugin/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: 'ok' }),
    });
    expect(res.status).toBe(200);
    const parsed = RunPluginActionRespSchema.parse(await res.json());
    const plugin = parsed.plugins.find((p) => p.id === 'act-plugin');
    expect(plugin?.configLabels['status']).toEqual({ text: 'Connected', color: 'success' });
    // doc 30 FR-30.5: the UIActionResult message rides back in the response.
    expect(parsed.result?.message).toBe('done');
    clearConfigLabelOverrides('act-plugin');
  });

  it('GET /api/plugins/ui lists a loaded plugin\'s registered UI elements (doc 30)', async () => {
    await loadActionPlugin();
    const res = await app().request('/api/plugins/ui');
    const parsed = ListPluginUiRespSchema.parse(await res.json());
    expect(parsed.elements).toContainEqual({
      type: 'button', id: 'act-btn', location: 'diff-toolbar', label: 'Act', action: 'ok', pluginId: 'act-plugin',
    });
  });

  it('GET /api/plugins/ui is empty when no plugins are loaded', async () => {
    __resetContentPluginsForTest();
    const res = await app().request('/api/plugins/ui');
    expect(ListPluginUiRespSchema.parse(await res.json()).elements).toEqual([]);
  });

  it('initially exposes the manifest label default before any action', async () => {
    await loadActionPlugin();
    const res = await app().request('/api/plugins');
    const parsed = ListPluginsRespSchema.parse(await res.json());
    const plugin = parsed.plugins.find((p) => p.id === 'act-plugin');
    expect(plugin?.configLabels['status']).toEqual({ text: 'Not tested', color: 'transient' });
    expect(plugin?.configLayout).toHaveLength(1);
    clearConfigLabelOverrides('act-plugin');
  });

  it('returns 400 + a clean error for an unknown plugin id', async () => {
    __resetContentPluginsForTest();
    const res = await app().request('/api/plugins/ghost/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: 'ok' }),
    });
    expect(res.status).toBe(400);
    const parsed = ListPluginsRespSchema.parse(await res.json());
    expect(parsed.error).toMatch(/not active/);
  });
});

describe('POST /api/plugins/:id/action — stateful control (doc 30 FR-30.3)', () => {
  // A toggle whose stateKey is a PROJECT-scoped preference, so persistence lands
  // in the tmp repo's .glassbox/settings.json (hermetic — no global-config write).
  async function loadStatePlugin(): Promise<void> {
    const pluginsRoot = mkdtempSync(join(tmpdir(), 'gb-stateplugins-'));
    const dir = join(pluginsRoot, 'state-plugin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      id: 'state-plugin', name: 'State Plugin', version: '1.0.0',
      preferences: [{ key: 'grid', label: 'Grid', type: 'boolean', scope: 'project' }],
    }));
    writeFileSync(join(dir, 'index.js'), `export default {
      activate(ctx) {
        ctx.registerUI([{ type: 'toggle', id: 't', location: 'sidebar-footer', stateKey: 'grid', action: 'toggle_grid', on: { label: 'On' }, off: { label: 'Off' } }]);
        return {};
      },
      onAction(actionId, ctx, value) { if (actionId === 'toggle_grid') return { message: 'grid ' + value }; },
    };`);
    const { registry, loaded } = await loadAllPlugins(pluginsRoot, undefined, repo);
    __setContentRegistryForTest(registry, loaded);
    rmSync(pluginsRoot, { recursive: true, force: true });
  }

  it('persists the toggled value to stateKey + resolves it in GET /plugins/ui, and threads value to onAction', async () => {
    await loadStatePlugin();
    const before = ListPluginUiRespSchema.parse(await (await app().request('/api/plugins/ui')).json());
    expect(before.elements.find((e) => e.id === 't')?.value).toBeUndefined();

    const actRes = await app().request('/api/plugins/state-plugin/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId: 'toggle_grid', value: 'true' }),
    });
    expect(actRes.status).toBe(200);
    expect(RunPluginActionRespSchema.parse(await actRes.json()).result?.message).toBe('grid true');

    const after = ListPluginUiRespSchema.parse(await (await app().request('/api/plugins/ui')).json());
    expect(after.elements.find((e) => e.id === 't')?.value).toBe('true');
  });
});
