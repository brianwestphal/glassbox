# Glassbox plugin: Image Codecs (WebP / AVIF)

Adds **WebP** and **AVIF** image decoders to Glassbox so **ground-truth image
comparisons** ([doc 26](../../docs/26-ground-truth-comparison.md)) in those formats
get a **perceptual difference score** (and most-different-first sorting) instead of
showing up unscored. It implements the `imageDecoders` capability from
[doc 29 §29.3 (FR-29.19)](../../docs/29-content-plugins.md).

Core decodes only PNG/JPEG. Screenshot tools increasingly emit WebP/AVIF, so a
WebP/AVIF baseline set otherwise displays the images with **no** score. Install this
plugin and scoring lights up.

## Why it's a separate, opt-in install

Unlike the PlantUML/Mermaid plugins, this one needs **no system dependency** — the
WebP and AVIF decoders are [jSquash](https://github.com/jamsinclair/jSquash) WASM
codecs, esbuild-bundled into a single self-contained `index.js` (the same
self-contained-bundle property that lets the Graphviz plugin load in the packaged
desktop app). It is separately installable (`autoInstall: false`) only to keep the
**~1.8 MB** of codec WASM out of the default install — most reviews never diff a
WebP/AVIF set.

It contributes **no renderer** — browsers already display WebP/AVIF natively via
`<img>`. It only adds the *decode-to-RGBA* capability the perceptual diff needs.

## Install

```bash
npm run build:plugins                     # build the self-contained plugin
node plugins/image-codecs/setup.mjs       # copy it into ~/.glassbox/plugins/
```

Then restart Glassbox and enable it in **Settings → Plugins** if needed. There is no
runtime `npm install` and nothing to download — the codecs ship inside the plugin.

`GLASSBOX_CONFIG_DIR` overrides `~/.glassbox` (e.g. for a scoped/test install).

## Fallback

If the plugin isn't installed (or a codec fails on a corrupt file), the comparison
is simply left **unscored** — the images still display, exactly as before. Nothing
crashes.

## Formats

| Extension | MIME | Codec |
| --- | --- | --- |
| `.webp` | `image/webp` | `@jsquash/webp` (libwebp WASM) |
| `.avif` | `image/avif` | `@jsquash/avif` (dav1d WASM) |
