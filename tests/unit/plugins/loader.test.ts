import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearAllPluginUIElements, clearConfigLabelOverrides, clearPluginUIElements, discoverPluginDirs, getConfigLabelOverride, getPluginUIElements, loadAllPlugins, loadPluginDir, readManifest } from '../../../src/plugins/loader.js';
import { ContentPluginRegistry } from '../../../src/plugins/registry.js';

let root: string;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'gb-plugins-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** Write a plugin dir. `entry` is the JS source; omit to leave no index.js. */
function makePlugin(name: string, opts: { manifest?: unknown; entry?: string; pkg?: unknown } = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  if (opts.manifest !== undefined) writeFileSync(join(dir, 'manifest.json'), JSON.stringify(opts.manifest));
  if (opts.pkg !== undefined) writeFileSync(join(dir, 'package.json'), JSON.stringify(opts.pkg));
  if (opts.entry !== undefined) writeFileSync(join(dir, 'index.js'), opts.entry);
  return dir;
}

const RENDERER_ENTRY = `export default {
  activate() {
    return { renderers: [{ name: 'diagram', match: { extensions: ['.mmd'] }, render: () => ({ svg: '<svg/>' }) }] };
  },
};`;

describe('plugin discovery (doc 29 FR-29.3)', () => {
  it('returns [] for a missing directory', () => {
    expect(discoverPluginDirs(join(root, 'nope'))).toEqual([]);
  });

  it('finds plugin subdirectories, skips dotfiles, and is sorted', () => {
    makePlugin('b-plugin');
    makePlugin('a-plugin');
    mkdirSync(join(root, '.hidden'));
    writeFileSync(join(root, 'loose.txt'), 'x');
    expect(discoverPluginDirs(root).map((d) => d.split('/').pop())).toEqual(['a-plugin', 'b-plugin']);
  });

  it('follows a symlink that resolves to a directory', () => {
    const real = mkdtempSync(join(tmpdir(), 'gb-realplugin-'));
    try {
      symlinkSync(real, join(root, 'linked'), 'dir');
      expect(discoverPluginDirs(root).map((d) => d.split('/').pop())).toContain('linked');
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });
});

describe('manifest reading (doc 29 FR-29.4)', () => {
  it('reads manifest.json', () => {
    const dir = makePlugin('p', { manifest: { id: 'p', name: 'P', version: '1' } });
    expect(readManifest(dir)?.id).toBe('p');
  });

  it('falls back to package.json#glassbox', () => {
    const dir = makePlugin('p', { pkg: { name: 'pkgname', version: '3', main: 'main.js', glassbox: { name: 'Pretty' } } });
    const m = readManifest(dir);
    expect(m?.id).toBe('pkgname');
    expect(m?.version).toBe('3');
    expect(m?.entry).toBe('main.js');
    expect(m?.name).toBe('Pretty');
  });

  it('returns null when neither file is present', () => {
    const dir = makePlugin('p');
    expect(readManifest(dir)).toBeNull();
  });
});

describe('fail-soft activation (doc 29 FR-29.6)', () => {
  it('loads + registers a valid plugin', async () => {
    const dir = makePlugin('ok', { manifest: { id: 'ok', name: 'OK', version: '1' }, entry: RENDERER_ENTRY });
    const reg = new ContentPluginRegistry();
    const res = await loadPluginDir(dir, reg);
    expect(res.status).toBe('loaded');
    expect(reg.rendererCount).toBe(1);
  });

  it('registers a plugin\'s imageDecoders (doc 29 imageDecoders, GB-1063)', async () => {
    const dir = makePlugin('dec', {
      manifest: { id: 'dec', name: 'D', version: '1' },
      entry: `export function activate() { return { imageDecoders: [{ name: 'webp', match: { extensions: ['.webp'] }, decode: () => ({ width: 1, height: 1, data: new Uint8Array(4) }) }] }; }`,
    });
    const reg = new ContentPluginRegistry();
    expect((await loadPluginDir(dir, reg)).status).toBe('loaded');
    expect(reg.imageDecoderCount).toBe(1);
    expect(reg.rendererCount).toBe(0);
  });

  it('records an error for an invalid manifest and does not throw', async () => {
    const dir = makePlugin('bad', { manifest: { name: 'no id' }, entry: RENDERER_ENTRY });
    const res = await loadPluginDir(dir, new ContentPluginRegistry());
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/manifest/);
  });

  it('records an error for a missing entry file', async () => {
    const dir = makePlugin('noentry', { manifest: { id: 'noentry', name: 'N', version: '1' } });
    const res = await loadPluginDir(dir, new ContentPluginRegistry());
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/entry not found/);
  });

  it('records an error when the entry throws on import', async () => {
    const dir = makePlugin('throws', { manifest: { id: 'throws', name: 'T', version: '1' }, entry: 'throw new Error("boom at import");' });
    const res = await loadPluginDir(dir, new ContentPluginRegistry());
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/boom at import/);
  });

  it('records an error when activate() throws', async () => {
    const dir = makePlugin('actthrows', {
      manifest: { id: 'actthrows', name: 'A', version: '1' },
      entry: 'export default { activate() { throw new Error("activate boom"); } };',
    });
    const res = await loadPluginDir(dir, new ContentPluginRegistry());
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/activate boom/);
  });

  it('records an error when the module exports no activate()', async () => {
    const dir = makePlugin('noactivate', { manifest: { id: 'noactivate', name: 'N', version: '1' }, entry: 'export default {};' });
    const res = await loadPluginDir(dir, new ContentPluginRegistry());
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/activate/);
  });

  it('a named activate export (no default) works', async () => {
    const dir = makePlugin('named', {
      manifest: { id: 'named', name: 'N', version: '1' },
      entry: `export function activate() { return { renderers: [{ name: 'r', match: { extensions: ['.x'] }, render: () => ({ html: '<b/>' }) }] }; }`,
    });
    const reg = new ContentPluginRegistry();
    expect((await loadPluginDir(dir, reg)).status).toBe('loaded');
    expect(reg.rendererCount).toBe(1);
  });

  it('one bad plugin does not stop a good one (loadAllPlugins)', async () => {
    makePlugin('good', { manifest: { id: 'good', name: 'G', version: '1' }, entry: RENDERER_ENTRY });
    makePlugin('broken', { manifest: { name: 'no id' } });
    const { registry, loaded } = await loadAllPlugins(root);
    expect(loaded).toHaveLength(2);
    expect(loaded.filter((p) => p.status === 'loaded')).toHaveLength(1);
    expect(loaded.filter((p) => p.status === 'error')).toHaveLength(1);
    expect(registry.rendererCount).toBe(1);
  });
});

describe('config-layout actions + dynamic labels (doc 29 FR-29.18)', () => {
  // A plugin whose activate + onAction both drive a config label.
  const ACTION_ENTRY = `export default {
    activate(ctx) { ctx.updateConfigLabel('status', 'ready', 'transient'); return {}; },
    async onAction(actionId, ctx) {
      if (actionId === 'ping') ctx.updateConfigLabel('status', 'pong', 'success');
    },
  };`;

  it('retains the plugin instance + context when loaded', async () => {
    const dir = makePlugin('act', { manifest: { id: 'act', name: 'A', version: '1' }, entry: ACTION_ENTRY });
    const res = await loadPluginDir(dir, new ContentPluginRegistry());
    expect(res.status).toBe('loaded');
    expect(typeof res.instance?.onAction).toBe('function');
    expect(res.context).toBeDefined();
  });

  it('updateConfigLabel writes an override the getter reads, and clear removes it', async () => {
    clearConfigLabelOverrides('act');
    const dir = makePlugin('act', { manifest: { id: 'act', name: 'A', version: '1' }, entry: ACTION_ENTRY });
    const res = await loadPluginDir(dir, new ContentPluginRegistry());
    // activate() seeded the label.
    expect(getConfigLabelOverride('act', 'status')).toEqual({ text: 'ready', color: 'transient' });
    // onAction mutates it via the retained context.
    await res.instance?.onAction?.('ping', res.context!);
    expect(getConfigLabelOverride('act', 'status')).toEqual({ text: 'pong', color: 'success' });
    clearConfigLabelOverrides('act');
    expect(getConfigLabelOverride('act', 'status')).toBeUndefined();
  });

  it('picks up a named onAction export (no default)', async () => {
    const dir = makePlugin('named-action', {
      manifest: { id: 'named-action', name: 'N', version: '1' },
      entry: `export function activate() { return {}; }
        export function onAction(id, ctx) { ctx.updateConfigLabel('s', id, 'success'); }`,
    });
    clearConfigLabelOverrides('named-action');
    const res = await loadPluginDir(dir, new ContentPluginRegistry());
    expect(typeof res.instance?.onAction).toBe('function');
    await res.instance?.onAction?.('hello', res.context!);
    expect(getConfigLabelOverride('named-action', 's')).toEqual({ text: 'hello', color: 'success' });
    clearConfigLabelOverrides('named-action');
  });
});

describe('UI-element registration (doc 30 FR-30.4)', () => {
  const UI_ENTRY = `export default {
    activate(ctx) {
      ctx.registerUI([{ type: 'button', id: 'b', location: 'header', label: 'Hi', action: 'go' }]);
      return {};
    },
    async onAction(actionId) { return actionId === 'go' ? { message: 'went' } : undefined; },
  };`;

  it('registerUI stores the plugin\'s elements; clear removes them', async () => {
    clearAllPluginUIElements();
    const dir = makePlugin('ui', { manifest: { id: 'ui', name: 'UI', version: '1' }, entry: UI_ENTRY });
    await loadPluginDir(dir, new ContentPluginRegistry());
    const groups = getPluginUIElements();
    const mine = groups.find((g) => g.pluginId === 'ui');
    expect(mine?.elements).toEqual([{ type: 'button', id: 'b', location: 'header', label: 'Hi', action: 'go' }]);
    clearPluginUIElements('ui');
    expect(getPluginUIElements().find((g) => g.pluginId === 'ui')).toBeUndefined();
  });

  it('re-activation replaces the previous element set (not appends)', async () => {
    clearAllPluginUIElements();
    const dir = makePlugin('ui2', { manifest: { id: 'ui2', name: 'UI2', version: '1' }, entry: UI_ENTRY });
    await loadPluginDir(dir, new ContentPluginRegistry());
    await loadPluginDir(dir, new ContentPluginRegistry()); // activate again
    expect(getPluginUIElements().find((g) => g.pluginId === 'ui2')?.elements).toHaveLength(1);
    clearAllPluginUIElements();
    expect(getPluginUIElements()).toHaveLength(0);
  });

  it('onAction can return a UIActionResult message (doc 30 FR-30.5)', async () => {
    clearAllPluginUIElements();
    const dir = makePlugin('ui3', { manifest: { id: 'ui3', name: 'UI3', version: '1' }, entry: UI_ENTRY });
    const res = await loadPluginDir(dir, new ContentPluginRegistry());
    expect(await res.instance?.onAction?.('go', res.context!)).toEqual({ message: 'went' });
    clearAllPluginUIElements();
  });
});

describe('enablement gating (doc 29 FR-29.16)', () => {
  it('a disabled plugin is recorded but not activated/registered', async () => {
    const dir = makePlugin('gv', { manifest: { id: 'gv', name: 'GV', version: '1' }, entry: RENDERER_ENTRY });
    const reg = new ContentPluginRegistry();
    const res = await loadPluginDir(dir, reg, () => ({ disabled: true, scope: 'project' }));
    expect(res.status).toBe('disabled');
    expect(res.disabledScope).toBe('project');
    expect(reg.rendererCount).toBe(0); // not registered
  });

  it('an enabled plugin still loads + registers', async () => {
    const dir = makePlugin('gv', { manifest: { id: 'gv', name: 'GV', version: '1' }, entry: RENDERER_ENTRY });
    const reg = new ContentPluginRegistry();
    const res = await loadPluginDir(dir, reg, () => ({ disabled: false }));
    expect(res.status).toBe('loaded');
    expect(reg.rendererCount).toBe(1);
  });

  it('loadAllPlugins applies the enablement check per plugin', async () => {
    makePlugin('on', { manifest: { id: 'on', name: 'On', version: '1' }, entry: RENDERER_ENTRY });
    makePlugin('off', { manifest: { id: 'off', name: 'Off', version: '1' }, entry: RENDERER_ENTRY });
    const { registry, loaded } = await loadAllPlugins(root, (id) =>
      id === 'off' ? { disabled: true, scope: 'global' } : { disabled: false },
    );
    expect(loaded.find((p) => p.id === 'off')?.status).toBe('disabled');
    expect(loaded.find((p) => p.id === 'on')?.status).toBe('loaded');
    expect(registry.rendererCount).toBe(1); // only 'on' registered
  });
});
