import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetContentPluginsForTest,
  __setContentRegistryForTest,
  diffContent,
  renderContent,
} from '../../../src/plugins/index.js';
import { ContentPluginRegistry } from '../../../src/plugins/registry.js';
import type { ContentDiffer, ContentRenderer } from '../../../src/plugins/types.js';

const mmdRenderer: ContentRenderer = {
  name: 'diagram',
  match: { extensions: ['.mmd'] },
  render: (input) => ({ svg: `<svg data-len="${input.text?.length ?? 0}"/>` }),
};

function registryWith(...rs: ContentRenderer[]): ContentPluginRegistry {
  const reg = new ContentPluginRegistry();
  reg.addRenderers(rs);
  return reg;
}

afterEach(() => __resetContentPluginsForTest());

describe('renderContent dispatch (doc 29 FR-29.9/29.13/29.14)', () => {
  it('renders with the matching plugin', async () => {
    __setContentRegistryForTest(registryWith(mmdRenderer));
    const view = await renderContent({ bytes: new Uint8Array(), text: 'graph', path: 'd.mmd' });
    expect(view?.svg).toContain('data-len="5"');
  });

  it('returns null when no plugin matches (fallback)', async () => {
    __setContentRegistryForTest(registryWith(mmdRenderer));
    expect(await renderContent({ bytes: new Uint8Array(), path: 'd.dot' })).toBeNull();
  });

  it('returns null (not throw) when the renderer throws', async () => {
    const boom: ContentRenderer = { name: 'boom', match: { extensions: ['.mmd'] }, render: () => { throw new Error('x'); } };
    __setContentRegistryForTest(registryWith(boom));
    expect(await renderContent({ bytes: new Uint8Array(), path: 'd.mmd' })).toBeNull();
  });

  it('returns null when the renderer yields an empty view', async () => {
    const empty: ContentRenderer = { name: 'empty', match: { extensions: ['.mmd'] }, render: () => ({}) };
    __setContentRegistryForTest(registryWith(empty));
    expect(await renderContent({ bytes: new Uint8Array(), path: 'd.mmd' })).toBeNull();
  });

  it('returns null with no registry initialized', async () => {
    __resetContentPluginsForTest();
    expect(await renderContent({ bytes: new Uint8Array(), path: 'd.mmd' })).toBeNull();
  });
});

describe('diffContent dispatch (doc 29 FR-29.10)', () => {
  it('diffs with the matching differ, keyed off the new side', async () => {
    const differ: ContentDiffer = {
      name: 'd', match: { extensions: ['.mmd'] },
      diff: (input) => ({ html: `<div>${input.new.path}</div>` }),
    };
    const reg = new ContentPluginRegistry();
    reg.addDiffers([differ]);
    __setContentRegistryForTest(reg);
    const view = await diffContent({
      old: { bytes: new Uint8Array(), path: 'old.mmd' },
      new: { bytes: new Uint8Array(), path: 'new.mmd' },
    });
    expect(view?.html).toBe('<div>new.mmd</div>');
  });
});

describe('feature flag / kill-switch (doc 29 NFR-29.4)', () => {
  it('PLUGINS_ENABLED honors GLASSBOX_PLUGINS_DISABLED', async () => {
    vi.resetModules();
    vi.stubEnv('GLASSBOX_PLUGINS_DISABLED', '1');
    const disabled = await import('../../../src/feature-flags.js');
    expect(disabled.PLUGINS_ENABLED).toBe(false);

    vi.resetModules();
    vi.stubEnv('GLASSBOX_PLUGINS_DISABLED', '');
    const enabled = await import('../../../src/feature-flags.js');
    expect(enabled.PLUGINS_ENABLED).toBe(true);

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
