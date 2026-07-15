#!/usr/bin/env node
/**
 * Setup helper for the Glassbox Mermaid plugin (doc 29, GB-1045). Because Mermaid
 * renders in a headless browser (there is no DOM-free/WASM engine), this plugin
 * is separately installable. This script:
 *
 *   1. verifies a usable `node` (this is running under one),
 *   2. installs the built plugin into `~/.glassbox/plugins/mermaid/`
 *      (honoring GLASSBOX_CONFIG_DIR), and
 *   3. installs `@mermaid-js/mermaid-cli` + `puppeteer` INTO that dir (puppeteer
 *      downloads a Chromium the first time), so the plugin can spawn a local
 *      `mmdc` — no network render service, fully offline.
 *
 * Usage:  node plugins/mermaid/setup.mjs
 * Env:    GLASSBOX_CONFIG_DIR   override ~/.glassbox
 *         MERMAID_CLI_VERSION   npm version of @mermaid-js/mermaid-cli (default below)
 *         PUPPETEER_VERSION     npm version of puppeteer (default below)
 *
 * The browser (~hundreds of MB) is NOT committed or shipped in the app bundle;
 * this provisions it into the user's install on demand. The `.mmd` code-block
 * fallback keeps working whether or not this succeeds.
 */
import { spawnSync } from 'child_process';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MERMAID_CLI_VERSION = process.env.MERMAID_CLI_VERSION ?? '11';
const PUPPETEER_VERSION = process.env.PUPPETEER_VERSION ?? '24';

const here = dirname(fileURLToPath(import.meta.url));
const configDir = process.env.GLASSBOX_CONFIG_DIR ?? join(homedir(), '.glassbox');
const installDir = join(configDir, 'plugins', 'mermaid');
const builtDir = join(here, '..', '..', 'dist', 'plugins', 'mermaid');

function installPlugin() {
  if (!existsSync(join(builtDir, 'index.js'))) {
    console.error(`✗ Built plugin not found at ${builtDir}. Run \`npm run build:plugins\` first.`);
    return false;
  }
  mkdirSync(installDir, { recursive: true });
  cpSync(builtDir, installDir, { recursive: true });
  console.log(`✓ Installed plugin into ${installDir}`);
  return true;
}

function installRenderer() {
  const cli = join(installDir, 'node_modules', '@mermaid-js', 'mermaid-cli', 'src', 'cli.js');
  if (existsSync(cli)) { console.log(`✓ mermaid-cli already present (${cli})`); return true; }
  console.log(`↓ Installing @mermaid-js/mermaid-cli@${MERMAID_CLI_VERSION} + puppeteer@${PUPPETEER_VERSION} into ${installDir} …`);
  console.log('  (puppeteer downloads a Chromium the first time — this can take a minute.)');
  const r = spawnSync(
    'npm',
    ['install', '--no-save', '--prefix', installDir,
     `@mermaid-js/mermaid-cli@${MERMAID_CLI_VERSION}`, `puppeteer@${PUPPETEER_VERSION}`],
    { stdio: 'inherit' },
  );
  if (r.error || r.status !== 0) {
    console.error('✗ Failed to install mermaid-cli / puppeteer. Ensure `npm` is on PATH and try again.');
    return false;
  }
  if (!existsSync(cli)) {
    console.error(`✗ Install ran but ${cli} is missing — the mermaid-cli layout may have changed.`);
    return false;
  }
  console.log('✓ mermaid-cli + puppeteer installed.');
  return true;
}

const installedOk = installPlugin();
const rendererOk = installedOk ? installRenderer() : false;

if (installedOk && rendererOk) {
  console.log('\n✓ Mermaid plugin ready. Restart Glassbox; enable it in Settings → Plugins if needed.');
} else {
  console.error('\n✗ Setup incomplete — see the messages above. The .mmd code-block fallback still works.');
  process.exitCode = 1;
}
