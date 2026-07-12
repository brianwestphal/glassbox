#!/usr/bin/env node
/**
 * Build first-party content plugins (doc 29): esbuild each
 * `plugins/<id>/src/index.ts` into a single self-contained ESM bundle at
 * `dist/plugins/<manifestId>/index.js` (its deps inlined, so the loader
 * resolves nothing against the host's node_modules — the property that lets a
 * plugin load against the frozen desktop sidecar), and copy its `manifest.json`
 * alongside.
 *
 * `dist/plugins/` is the bundled-plugin source that `scripts/build-sidecar.sh`
 * copies into the sidecar (`server/plugins`), from which `installBundledPlugins`
 * seeds `~/.glassbox/plugins/` at startup (GB-1039).
 *
 * Usage: node scripts/build-plugins.mjs [pluginDir ...]   (default: all)
 */
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(root, 'plugins');
const outRoot = join(root, 'dist', 'plugins');

const requested = process.argv.slice(2);
const dirs = (existsSync(pluginsDir) ? readdirSync(pluginsDir) : []).filter(
  (name) => (requested.length === 0 || requested.includes(name)) && existsSync(join(pluginsDir, name, 'src', 'index.ts')),
);

if (dirs.length === 0) {
  console.log('No plugins to build.');
  process.exit(0);
}

for (const name of dirs) {
  const srcDir = join(pluginsDir, name);
  const manifestPath = join(srcDir, 'manifest.json');
  // Output under the manifest id so the on-disk dir name matches the plugin id.
  const id = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')).id ?? name) : name;
  const outDir = join(outRoot, id);
  mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints: [join(srcDir, 'src', 'index.ts')],
    outfile: join(outDir, 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    minify: true,
    logLevel: 'warning',
  });
  if (existsSync(manifestPath)) copyFileSync(manifestPath, join(outDir, 'manifest.json'));
  console.log(`built plugin: ${name} -> ${join('dist', 'plugins', id)}`);
}
