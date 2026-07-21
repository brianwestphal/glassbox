/**
 * Glassbox content plugin: WebP + AVIF image decoders (doc 29 FR-29.19, GB-1064).
 * The reference plugin for the `imageDecoders` capability.
 *
 * It contributes no renderer/differ — browsers already display WebP/AVIF natively
 * via `<img>`. What it adds is the ability to decode those formats to RGBA so the
 * perceptual diff (doc 26 P2) can score ground-truth comparisons in them (a
 * difference score + most-different-first sort) instead of leaving them unscored.
 *
 * The jSquash WASM codecs are esbuild-bundled into this self-contained `index.js`,
 * with each decoder's `.wasm` imported as an inlined binary (the `binary` loader,
 * wired in `scripts/build-plugins.mjs`) so nothing is resolved against the host's
 * `node_modules` at runtime — the property that lets it load in the frozen desktop
 * sidecar, exactly like graphviz's `@viz-js/viz`. The activation logic lives in
 * `plugin.ts`; this entry only binds the inlined binaries to it.
 */
import AVIF_DEC_WASM from '@jsquash/avif/codec/dec/avif_dec.wasm';
import WEBP_DEC_WASM from '@jsquash/webp/codec/dec/webp_dec.wasm';

import { createPlugin } from './plugin.js';

export default createPlugin((codec) => (codec === 'webp' ? WEBP_DEC_WASM : AVIF_DEC_WASM));
