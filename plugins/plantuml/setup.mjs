#!/usr/bin/env node
/**
 * Setup helper for the Glassbox PlantUML plugin (doc 29, GB-1046). Because
 * PlantUML needs Java + a `plantuml.jar` (there is no pure-JS/WASM engine), this
 * plugin is separately installable. This script:
 *
 *   1. verifies a local `java` is on PATH,
 *   2. installs the built plugin into `~/.glassbox/plugins/plantuml/`
 *      (honoring GLASSBOX_CONFIG_DIR), and
 *   3. downloads `plantuml.jar` into that dir (from Maven Central).
 *
 * Usage:  node plugins/plantuml/setup.mjs
 * Env:    GLASSBOX_CONFIG_DIR   override ~/.glassbox
 *         PLANTUML_VERSION      Maven version to fetch (default below)
 *         PLANTUML_JAR_URL      full override URL for the jar
 *
 * The jar is NOT committed to the repo or shipped in the bundle (it's ~11 MB and
 * GPL); this fetches it into the user's install on demand. You can also drop your
 * own `plantuml.jar` into the plugin dir manually.
 */
import { spawnSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const PLANTUML_VERSION = process.env.PLANTUML_VERSION ?? '1.2024.8';
const JAR_URL = process.env.PLANTUML_JAR_URL
  ?? `https://repo1.maven.org/maven2/net/sourceforge/plantuml/plantuml/${PLANTUML_VERSION}/plantuml-${PLANTUML_VERSION}.jar`;

const here = dirname(fileURLToPath(import.meta.url));
const configDir = process.env.GLASSBOX_CONFIG_DIR ?? join(homedir(), '.glassbox');
const installDir = join(configDir, 'plugins', 'plantuml');
const builtDir = join(here, '..', '..', 'dist', 'plugins', 'plantuml');

function checkJava() {
  const r = spawnSync('java', ['-version'], { stdio: 'pipe' });
  if (r.error || r.status !== 0) {
    console.error('✗ Java not found on PATH. PlantUML needs a JRE (Java 8+).');
    console.error('  Install it (e.g. `brew install openjdk`, `apt install default-jre`), then re-run.');
    return false;
  }
  const v = (r.stderr?.toString() ?? '').split('\n')[0].trim();
  console.log(`✓ Java found: ${v}`);
  return true;
}

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

async function fetchJar() {
  const dest = join(installDir, 'plantuml.jar');
  if (existsSync(dest)) { console.log(`✓ plantuml.jar already present (${dest})`); return true; }
  console.log(`↓ Downloading plantuml.jar from ${JAR_URL} …`);
  try {
    const res = await fetch(JAR_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1_000_000) throw new Error(`suspiciously small (${buf.length} bytes) — wrong URL/version?`);
    writeFileSync(dest, buf);
    console.log(`✓ Saved plantuml.jar (${(buf.length / 1e6).toFixed(1)} MB) → ${dest}`);
    return true;
  } catch (e) {
    console.error(`✗ Download failed: ${e instanceof Error ? e.message : String(e)}`);
    console.error('  Set PLANTUML_VERSION or PLANTUML_JAR_URL, or drop plantuml.jar into the plugin dir manually.');
    return false;
  }
}

const javaOk = checkJava();
const installedOk = installPlugin();
const jarOk = installedOk ? await fetchJar() : false;

if (javaOk && installedOk && jarOk) {
  console.log('\n✓ PlantUML plugin ready. Restart Glassbox; enable it in Settings → Plugins if needed.');
} else {
  console.error('\n✗ Setup incomplete — see the messages above. The .puml code-block fallback still works.');
  process.exitCode = 1;
}
