#!/usr/bin/env node
/**
 * Build first-party content plugins (doc 29): esbuild each
 * `plugins/<id>/src/index.ts` into a single self-contained ESM `plugins/<id>/index.js`
 * carrying its own dependencies (so the loader resolves nothing against the
 * host's node_modules — the property that lets plugins load against the frozen
 * desktop sidecar). The built `index.js` is a git-ignored build artifact.
 *
 * Desktop packaging (copy into the sidecar + auto-install) is GB-1039; this
 * script is the source-of-truth build it will call.
 *
 * Usage: node scripts/build-plugins.mjs [pluginId ...]   (default: all)
 */
import { build } from 'esbuild';
import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(root, 'plugins');

const requested = process.argv.slice(2);
const ids = (existsSync(pluginsDir) ? readdirSync(pluginsDir) : []).filter(
  (name) => (requested.length === 0 || requested.includes(name)) && existsSync(join(pluginsDir, name, 'src', 'index.ts')),
);

if (ids.length === 0) {
  console.log('No plugins to build.');
  process.exit(0);
}

for (const id of ids) {
  const entry = join(pluginsDir, id, 'src', 'index.ts');
  const outfile = join(pluginsDir, id, 'index.js');
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    // Bundle everything (incl. the WASM-inlined @viz-js/viz) into one file.
    minify: true,
    logLevel: 'warning',
  });
  console.log(`built plugin: ${id} -> ${outfile}`);
}
