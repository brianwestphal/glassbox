/**
 * The WebP + AVIF image decoders (doc 29 FR-29.19 `imageDecoders`): decode bytes
 * -> RGBA so the perceptual diff (doc 26 P2) can score ground-truth pairs in
 * formats core (PNG/JPEG) can't.
 *
 * Decoding runs on the jSquash WASM codecs (`@jsquash/webp`, `@jsquash/avif`),
 * which are esbuild-bundled into this plugin's self-contained `index.js`. The
 * WASM *bytes*, however, are supplied by the caller (`WasmLoader`) rather than
 * imported here — `index.ts` passes the esbuild-inlined binaries, while tests
 * pass the on-disk `.wasm` from `node_modules` — so this module never depends on
 * the bundler's `.wasm` import mechanism and stays unit-testable in plain Node.
 */
import decodeAvif, { init as initAvif } from '@jsquash/avif/decode.js';
import decodeWebp, { init as initWebp } from '@jsquash/webp/decode.js';

import type { DecodedImage, ImageDecodeInput, ImageDecoder } from './types.js';

/** Which codec's WASM to load. */
export type Codec = 'webp' | 'avif';

/** Supplies a codec's raw WASM bytes. Injected so the plugin entry passes
 *  esbuild-inlined binaries and tests pass on-disk bytes. */
export type WasmLoader = (codec: Codec) => Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer>;

// jSquash's published `init` type only exposes the module-options form, but the
// runtime also accepts a compiled `WebAssembly.Module` as the first argument (its
// documented manual-instantiation path). Narrow to that real signature.
type WasmInit = (module: WebAssembly.Module) => Promise<void>;

/** A jSquash decode result is ImageData-shaped: RGBA `data` + dimensions. */
interface JsquashImage { data: Uint8Array | Uint8ClampedArray; width: number; height: number }

/** Copy-free view of RGBA bytes as a Uint8Array (the DecodedImage contract). */
function toRgba(img: JsquashImage): DecodedImage {
  const d = img.data;
  const data = d instanceof Uint8Array ? d : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  return { width: img.width, height: img.height, data };
}

/** An exact ArrayBuffer of a typed array's bytes (jSquash decode wants ArrayBuffer). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Build the WebP + AVIF image decoders, lazily initializing each codec's WASM
 *  (compiled once from `loadWasm`, on first use) and fail-soft on any error. */
export function createImageDecoders(loadWasm: WasmLoader): ImageDecoder[] {
  let webpReady: Promise<void> | null = null;
  let avifReady: Promise<void> | null = null;
  const ensure = (codec: Codec, init: WasmInit): Promise<void> => {
    const run = async (): Promise<void> => {
      const src = await loadWasm(codec);
      const buf = src instanceof Uint8Array ? toArrayBuffer(src) : src;
      await init(await WebAssembly.compile(buf));
    };
    if (codec === 'webp') return (webpReady ??= run());
    return (avifReady ??= run());
  };

  const decoder = (
    name: Codec,
    extensions: string[],
    mimeTypes: string[],
    init: WasmInit,
    decode: (buf: ArrayBuffer) => Promise<JsquashImage | null>,
  ): ImageDecoder => ({
    name,
    match: { extensions, mimeTypes },
    async decode({ bytes }: ImageDecodeInput): Promise<DecodedImage | null> {
      try {
        await ensure(name, init);
        const img = await decode(toArrayBuffer(bytes));
        return img === null ? null : toRgba(img);
      } catch {
        // Corrupt / unexpected bytes -> fail-soft, the pair stays unscored.
        return null;
      }
    },
  });

  return [
    decoder('webp', ['.webp'], ['image/webp'], initWebp as unknown as WasmInit, (buf) => decodeWebp(buf)),
    decoder('avif', ['.avif'], ['image/avif'], initAvif as unknown as WasmInit, (buf) => decodeAvif(buf)),
  ];
}
