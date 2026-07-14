/**
 * Config-layout button actions (doc 29 FR-29.18): `runPluginAction` dispatch and
 * its guard branches. The happy path (onAction runs against its real context and
 * the label override is read back through `describeInstalledPlugins`) is covered
 * end-to-end in the plugins-routes integration test; here we pin the error guards
 * with the in-memory test seam.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { __resetContentPluginsForTest, __setContentRegistryForTest, runPluginAction } from '../../../src/plugins/index.js';
import type { LoadedPlugin } from '../../../src/plugins/loader.js';
import { ContentPluginRegistry } from '../../../src/plugins/registry.js';
import type { ContentPlugin, PluginContext } from '../../../src/plugins/types.js';

const ctx: PluginContext = {
  log: () => {},
  getSetting: () => Promise.resolve(null),
  setSetting: () => Promise.resolve(),
  updateConfigLabel: () => {},
  registerUI: () => {},
};

function loaded(over: Partial<LoadedPlugin>): LoadedPlugin {
  return { id: 'p', dir: '/x', manifest: null, status: 'loaded', ...over };
}

afterEach(() => __resetContentPluginsForTest());

describe('runPluginAction (doc 29 FR-29.18)', () => {
  it('invokes the plugin onAction with its retained context and returns its result', async () => {
    const onAction = vi.fn<NonNullable<ContentPlugin['onAction']>>().mockResolvedValue({ message: 'hi' });
    __setContentRegistryForTest(new ContentPluginRegistry(), [loaded({ instance: { activate: () => {}, onAction }, context: ctx })]);
    const result = await runPluginAction('p', 'go');
    expect(onAction).toHaveBeenCalledWith('go', ctx, undefined);
    expect(result).toEqual({ message: 'hi' }); // doc 30 FR-30.5 result passthrough
  });

  it('throws "Plugin not active" for an unknown id', async () => {
    __setContentRegistryForTest(new ContentPluginRegistry(), []);
    await expect(runPluginAction('nope', 'go')).rejects.toThrow(/not active/);
  });

  it('throws "Plugin not active" when the plugin failed to load', async () => {
    __setContentRegistryForTest(new ContentPluginRegistry(), [loaded({ status: 'error', instance: undefined, context: undefined })]);
    await expect(runPluginAction('p', 'go')).rejects.toThrow(/not active/);
  });

  it('throws "does not handle actions" when the plugin declares no onAction', async () => {
    __setContentRegistryForTest(new ContentPluginRegistry(), [loaded({ instance: { activate: () => {} }, context: ctx })]);
    await expect(runPluginAction('p', 'go')).rejects.toThrow(/does not handle actions/);
  });
});
