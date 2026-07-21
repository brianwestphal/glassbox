import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetContentPluginsForTest,
  __setContentRegistryForTest,
  decodeImageWithPlugin,
  diffContent,
  renderContent,
} from '../../../src/plugins/index.js';
import { ContentPluginRegistry } from '../../../src/plugins/registry.js';
import type { ContentDiffer, ContentRenderer, ImageDecoder } from '../../../src/plugins/types.js';

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

describe('decodeImageWithPlugin dispatch (doc 29 imageDecoders, GB-1063)', () => {
  const webpDecoder: ImageDecoder = {
    name: 'webp', match: { extensions: ['.webp'] },
    decode: (input) => ({ width: input.bytes.length, height: 1, data: new Uint8Array(input.bytes.length * 4) }),
  };
  function registryWithDecoder(d: ImageDecoder): ContentPluginRegistry {
    const reg = new ContentPluginRegistry();
    reg.addImageDecoders([d]);
    return reg;
  }

  it('decodes with the matching plugin decoder', async () => {
    __setContentRegistryForTest(registryWithDecoder(webpDecoder));
    const out = await decodeImageWithPlugin(new Uint8Array(3), 'shot.webp');
    expect(out).toEqual({ width: 3, height: 1, data: new Uint8Array(12) });
  });

  it('returns null when no decoder matches (fallback to undecodable)', async () => {
    __setContentRegistryForTest(registryWithDecoder(webpDecoder));
    expect(await decodeImageWithPlugin(new Uint8Array(3), 'shot.gif')).toBeNull();
  });

  it('returns null (not throw) when the decoder throws', async () => {
    const boom: ImageDecoder = { name: 'boom', match: { extensions: ['.webp'] }, decode: () => { throw new Error('x'); } };
    __setContentRegistryForTest(registryWithDecoder(boom));
    expect(await decodeImageWithPlugin(new Uint8Array(1), 'x.webp')).toBeNull();
  });

  it('returns null when the decoder returns null', async () => {
    const nuller: ImageDecoder = { name: 'null', match: { extensions: ['.webp'] }, decode: () => null };
    __setContentRegistryForTest(registryWithDecoder(nuller));
    expect(await decodeImageWithPlugin(new Uint8Array(1), 'x.webp')).toBeNull();
  });

  it('returns null with no registry initialized', async () => {
    __resetContentPluginsForTest();
    expect(await decodeImageWithPlugin(new Uint8Array(1), 'x.webp')).toBeNull();
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
