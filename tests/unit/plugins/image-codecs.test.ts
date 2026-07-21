import { readFileSync } from 'fs';
import { join } from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { createImageDecoders, type WasmLoader } from '../../../plugins/image-codecs/src/decoder.js';
import { createPlugin } from '../../../plugins/image-codecs/src/plugin.js';
import type { ImageDecoder, PluginContext } from '../../../plugins/image-codecs/src/types.js';
import { comparePerceptual } from '../../../src/ground-truth/perceptual-diff.js';
import { __resetContentPluginsForTest, __setContentRegistryForTest } from '../../../src/plugins/index.js';
import { ContentPluginRegistry } from '../../../src/plugins/registry.js';

// The image-codecs reference plugin (doc 29 FR-29.19, GB-1064): real WebP + AVIF
// decode to RGBA, driving the perceptual diff. The WASM bytes come from the
// jSquash packages on disk (the same codecs esbuild inlines into the bundled
// plugin), so this exercises the real decode path without the bundler's `.wasm`
// import.
const CODEC_WASM: Record<'webp' | 'avif', string> = {
  webp: 'node_modules/@jsquash/webp/codec/dec/webp_dec.wasm',
  avif: 'node_modules/@jsquash/avif/codec/dec/avif_dec.wasm',
};
const loadWasm: WasmLoader = (codec) => new Uint8Array(readFileSync(join(process.cwd(), CODEC_WASM[codec])));

const FIXTURES = join(process.cwd(), 'tests/fixtures/images');
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

function ctx(): PluginContext & { logs: string[] } {
  const logs: string[] = [];
  return { logs, log: (_l, m) => logs.push(m), getSetting: () => Promise.resolve(null), setSetting: () => Promise.resolve() };
}

describe('image-codecs plugin (doc 29 FR-29.19, GB-1064)', () => {
  it('registers webp + avif decoders with ext + MIME matches', () => {
    const [webp, avif] = createImageDecoders(loadWasm);
    expect(webp.name).toBe('webp');
    expect(webp.match.extensions).toEqual(['.webp']);
    expect(webp.match.mimeTypes).toEqual(['image/webp']);
    expect(avif.name).toBe('avif');
    expect(avif.match.extensions).toEqual(['.avif']);
    expect(avif.match.mimeTypes).toEqual(['image/avif']);
  });

  it('activate() logs + returns the two image decoders (no renderer/differ)', async () => {
    const c = ctx();
    const reg = await createPlugin(loadWasm).activate(c);
    expect(reg).toBeDefined();
    expect(reg?.imageDecoders?.map((d) => d.name)).toEqual(['webp', 'avif']);
    expect(c.logs.join(' ')).toContain('image-codecs plugin activated');
  });

  it('decodes a real WebP to RGBA (8x8, lossless → exact color)', async () => {
    const [webp] = createImageDecoders(loadWasm);
    const img = await webp.decode({ bytes: fixture('solid-red.webp'), path: 'solid-red.webp' });
    expect(img).not.toBeNull();
    expect(img!.width).toBe(8);
    expect(img!.height).toBe(8);
    expect(img!.data.length).toBe(8 * 8 * 4);
    // Fixture is a lossless solid red — the first pixel decodes exactly.
    expect([img!.data[0], img!.data[1], img!.data[2], img!.data[3]]).toEqual([200, 30, 40, 255]);
  });

  it('decodes a real AVIF to RGBA (8x8)', async () => {
    const [, avif] = createImageDecoders(loadWasm);
    const img = await avif.decode({ bytes: fixture('solid-red.avif'), path: 'solid-red.avif' });
    expect(img).not.toBeNull();
    expect(img!.width).toBe(8);
    expect(img!.height).toBe(8);
    expect(img!.data.length).toBe(8 * 8 * 4);
    expect(img!.data[3]).toBe(255); // opaque
  });

  it('is fail-soft: garbage bytes decode to null (no crash), both codecs', async () => {
    const [webp, avif] = createImageDecoders(loadWasm);
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await webp.decode({ bytes: garbage, path: 'x.webp' })).toBeNull();
    expect(await avif.decode({ bytes: garbage, path: 'x.avif' })).toBeNull();
  });

  // End-to-end with the capability (GB-1063): the real decoders installed in the
  // registry make an otherwise-undecodable WebP pair scorable via comparePerceptual.
  describe('drives the perceptual diff (doc 26 P2) via the imageDecoders capability', () => {
    afterEach(() => __resetContentPluginsForTest());

    function installDecoders(decoders: ImageDecoder[]): void {
      const reg = new ContentPluginRegistry();
      reg.addImageDecoders(decoders);
      __setContentRegistryForTest(reg);
    }

    it('scores identical WebP images as 0 (was undecodable without the plugin)', async () => {
      // Without the plugin: core can't decode WebP → undecodable.
      __setContentRegistryForTest(new ContentPluginRegistry());
      const before = await comparePerceptual(join(FIXTURES, 'solid-red.webp'), join(FIXTURES, 'solid-red-copy.webp'));
      expect(before.reason).toBe('undecodable');

      // With the plugin installed: the pair becomes scorable and identical.
      installDecoders(createImageDecoders(loadWasm));
      const after = await comparePerceptual(join(FIXTURES, 'solid-red.webp'), join(FIXTURES, 'solid-red-copy.webp'));
      expect(after.reason).toBe('ok');
      expect(after.scorable).toBe(true);
      expect(after.score).toBe(0);
      expect(after.totalPixels).toBe(64);
    });

    it('scores two different WebP images as changed (score > 0)', async () => {
      installDecoders(createImageDecoders(loadWasm));
      const result = await comparePerceptual(join(FIXTURES, 'solid-red.webp'), join(FIXTURES, 'solid-blue.webp'));
      expect(result.reason).toBe('ok');
      expect(result.scorable).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    });
  });
});
