/**
 * Integration test for the opt-in bundled-plugin install routes (doc 29 §29.2,
 * GB-1069): `GET /api/plugins/available` lists the opt-in bundled plugins not yet
 * installed, and `POST /api/plugins/:id/install-bundled` installs one (readiness
 * check + auto-provision) and returns the result + refreshed lists.
 *
 * The install writes into `GLASSBOX_CONFIG_DIR/plugins` and reads the bundle from
 * `GLASSBOX_BUNDLED_PLUGINS_DIR`; both are pointed at disposable temp dirs (via
 * stubEnv + a fresh module graph) so the test never touches real state. A
 * self-contained fixture plugin keeps it deterministic (no network / npm).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import type { Hono as HonoType } from 'hono';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../../src/types.js';

let root: string;
let bundledDir: string;
let configDir: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gb-install-route-'));
  bundledDir = join(root, 'bundled');
  configDir = join(root, 'config');
  repo = join(root, 'repo');
  mkdirSync(bundledDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(repo, { recursive: true });

  // A self-contained opt-in fixture plugin in the bundle.
  const dir = join(bundledDir, 'fixture-codec');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    id: 'fixture-codec', name: 'Fixture Codec', version: '1.0.0', autoInstall: false,
    contentTypes: [{ extensions: ['.zzz'] }],
  }));
  writeFileSync(join(dir, 'index.js'), 'export default { activate() { return {}; } };');

  vi.stubEnv('GLASSBOX_CONFIG_DIR', configDir);
  vi.stubEnv('GLASSBOX_BUNDLED_PLUGINS_DIR', bundledDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  rmSync(root, { recursive: true, force: true });
});

async function app(): Promise<HonoType<AppEnv>> {
  const { Hono } = await import('hono');
  const { pluginsRoutes } = await import('../../../src/routes/api/plugins.js');
  const a = new Hono<AppEnv>();
  a.use('*', async (c, next) => { c.set('repoRoot', repo); await next(); });
  a.route('/api', pluginsRoutes);
  return a;
}

describe('opt-in bundled-plugin install routes (GB-1069)', () => {
  it('GET /api/plugins/available lists the opt-in fixture (schema-valid)', async () => {
    const { ListAvailablePluginsRespSchema } = await import('../../../src/api/plugins.js');
    const res = await (await app()).request('/api/plugins/available');
    expect(res.status).toBe(200);
    const body = ListAvailablePluginsRespSchema.parse(await res.json());
    const codec = body.available.find((a) => a.id === 'fixture-codec');
    expect(codec).toBeDefined();
    expect(codec?.selfContained).toBe(true);
    expect(codec?.extensions).toEqual(['.zzz']);
  });

  it('POST /api/plugins/:id/install-bundled installs a self-contained plugin → ready + moves lists', async () => {
    const { InstallBundledPluginRespSchema } = await import('../../../src/api/plugins.js');
    const res = await (await app()).request('/api/plugins/fixture-codec/install-bundled', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = InstallBundledPluginRespSchema.parse(await res.json());
    expect(body.result.status).toBe('ready');
    expect(body.result.installed).toBe(true);
    // It now appears in the installed list and is gone from "available".
    expect(body.plugins.map((p) => p.id)).toContain('fixture-codec');
    expect(body.available.map((a) => a.id)).not.toContain('fixture-codec');
    // And it's on disk in the config plugins dir.
    expect(existsSync(join(configDir, 'plugins', 'fixture-codec', 'manifest.json'))).toBe(true);
  });

  it('POST install-bundled for an unknown id returns a schema-valid error result', async () => {
    const { InstallBundledPluginRespSchema } = await import('../../../src/api/plugins.js');
    const res = await (await app()).request('/api/plugins/nope/install-bundled', { method: 'POST' });
    const body = InstallBundledPluginRespSchema.parse(await res.json());
    expect(body.result.status).toBe('error');
    expect(body.result.installed).toBe(false);
  });

  it('DELETE returns the available list so an uninstalled opt-in plugin re-appears (GB-1070)', async () => {
    const { UninstallPluginRespSchema } = await import('../../../src/api/plugins.js');
    const a = await app();
    // Install it, then uninstall it.
    await a.request('/api/plugins/fixture-codec/install-bundled', { method: 'POST' });
    const res = await a.request('/api/plugins/fixture-codec', { method: 'DELETE' });
    const body = UninstallPluginRespSchema.parse(await res.json());
    // Gone from installed, back in available.
    expect(body.plugins.map((p) => p.id)).not.toContain('fixture-codec');
    expect((body.available ?? []).map((av) => av.id)).toContain('fixture-codec');
  });
});
