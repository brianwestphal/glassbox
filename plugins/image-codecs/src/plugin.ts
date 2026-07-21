/**
 * The image-codecs plugin, parameterized over how its codec WASM is loaded
 * (`WasmLoader`). `index.ts` supplies the esbuild-inlined binaries; tests supply
 * on-disk bytes — so the plugin's `activate` registration is unit-testable in
 * plain Node without the bundler's `.wasm` import.
 */
import { createImageDecoders, type WasmLoader } from './decoder.js';
import type { ContentPlugin } from './types.js';

/** Build the image-codecs content plugin over an injected WASM loader. */
export function createPlugin(loadWasm: WasmLoader): ContentPlugin {
  const decoders = createImageDecoders(loadWasm);
  return {
    activate(context) {
      context.log('info', 'image-codecs plugin activated (image decoders: .webp, .avif)');
      return { imageDecoders: decoders };
    },
  };
}
