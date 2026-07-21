#!/usr/bin/env node
/**
 * Setup helper for the Glassbox image-codecs plugin (doc 29, GB-1064). Unlike the
 * PlantUML / Mermaid opt-in plugins, this one has NO system dependency and NO
 * runtime `npm install` — its WebP + AVIF WASM codecs are esbuild-bundled into a
 * single self-contained `index.js`. "Installing" is therefore just copying the
 * built plugin into `~/.glassbox/plugins/image-codecs/`.
 *
 * It's separately installable (manifest `autoInstall: false`) only to keep the
 * ~1.8 MB of codec WASM out of the default install — most reviews never diff a
 * WebP/AVIF ground-truth set. Install it when you do.
 *
 * Usage:  node plugins/image-codecs/setup.mjs
 * Env:    GLASSBOX_CONFIG_DIR   override ~/.glassbox
 */
import { cpSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const configDir = process.env.GLASSBOX_CONFIG_DIR ?? join(homedir(), '.glassbox');
const installDir = join(configDir, 'plugins', 'image-codecs');
const builtDir = join(here, '..', '..', 'dist', 'plugins', 'image-codecs');

if (!existsSync(join(builtDir, 'index.js'))) {
  console.error(`✗ Built plugin not found at ${builtDir}. Run \`npm run build:plugins\` first.`);
  process.exit(1);
}

mkdirSync(installDir, { recursive: true });
cpSync(builtDir, installDir, { recursive: true });
console.log(`✓ Installed image-codecs plugin into ${installDir}`);
console.log('  Restart Glassbox; enable it in Settings → Plugins if needed.');
console.log('  WebP/AVIF ground-truth comparisons will now get a perceptual difference score.');
