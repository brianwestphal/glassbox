import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installAvailablePlugin } from '../../../src/plugins/install-action.js';
import type { PluginManifest } from '../../../src/plugins/manifest.js';

// doc 29 §29.2 (GB-1069) — install an opt-in bundled plugin: copy + readiness
// check + auto-provision, returning what remains as instructions.
describe('installAvailablePlugin', () => {
  let root: string;
  let bundledDir: string;
  let userDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gb-install-'));
    bundledDir = join(root, 'bundled');
    userDir = join(root, 'user-plugins');
    mkdirSync(bundledDir, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** Write a bundled plugin (manifest + a tiny index.js) under `bundledDir`. */
  const writeBundled = (id: string, manifest: Partial<PluginManifest>): void => {
    const dir = join(bundledDir, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, name: id, version: '1.0.0', autoInstall: false, ...manifest }));
    writeFileSync(join(dir, 'index.js'), 'export default { activate() { return {}; } };');
  };

  const okFetch = async (): Promise<Uint8Array> => new Uint8Array([1, 2, 3, 4]);
  const okNpm = (): { ok: boolean; detail: string } => ({ ok: true, detail: 'installed' });

  it('installs a self-contained plugin (copy only) → ready, no instructions', async () => {
    writeBundled('codec', { contentTypes: [{ extensions: ['.webp'] }] });
    const r = await installAvailablePlugin('codec', { bundledDir, userDir });
    expect(r.installed).toBe(true);
    expect(r.status).toBe('ready');
    expect(r.instructions).toEqual([]);
    expect(existsSync(join(userDir, 'codec', 'index.js'))).toBe(true);
    expect(existsSync(join(userDir, 'codec', 'manifest.json'))).toBe(true);
  });

  it('fetch provisioning runs and writes the file → ready', async () => {
    writeBundled('puml', { install: { provision: [{ kind: 'fetch', url: 'https://x/plantuml.jar', dest: 'plantuml.jar' }] } });
    const r = await installAvailablePlugin('puml', { bundledDir, userDir, fetchBytes: okFetch });
    expect(r.status).toBe('ready');
    expect(r.provisioned[0]).toMatchObject({ ok: true, skipped: false });
    expect(readFileSync(join(userDir, 'puml', 'plantuml.jar'))).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('auto-fixes what it can but still lists an unmet requirement (fetch runs; Java missing)', async () => {
    writeBundled('puml', {
      install: {
        requirements: [{ id: 'java', label: 'Java', command: 'java', checkArgs: ['-version'], hint: 'install a JRE' }],
        provision: [{ kind: 'fetch', url: 'https://x/plantuml.jar', dest: 'plantuml.jar' }],
        cliHint: 'node plugins/plantuml/setup.mjs',
      },
    });
    const r = await installAvailablePlugin('puml', { bundledDir, userDir, fetchBytes: okFetch, runProbe: () => false });
    expect(r.installed).toBe(true);
    expect(r.status).toBe('needs-setup');
    // The fetch still ran (auto-fix), but the missing Java is surfaced with its hint + the CLI fallback.
    expect(existsSync(join(userDir, 'puml', 'plantuml.jar'))).toBe(true);
    expect(r.instructions.some((i) => i.includes('install a JRE'))).toBe(true);
    expect(r.instructions.some((i) => i.includes('node plugins/plantuml/setup.mjs'))).toBe(true);
  });

  it('runs npm-install when npm is present → ready', async () => {
    writeBundled('mmd', {
      install: {
        requirements: [{ id: 'npm', label: 'npm', command: 'npm', hint: 'install node' }],
        provision: [{ kind: 'npm-install', packages: ['@mermaid-js/mermaid-cli@11'], requires: 'npm' }],
      },
    });
    const r = await installAvailablePlugin('mmd', { bundledDir, userDir, runProbe: () => true, runNpmInstall: okNpm });
    expect(r.status).toBe('ready');
    expect(r.provisioned[0]).toMatchObject({ ok: true, skipped: false });
  });

  it('skips npm-install when npm is missing → needs-setup with instructions', async () => {
    let npmRan = false;
    writeBundled('mmd', {
      install: {
        requirements: [{ id: 'npm', label: 'npm', command: 'npm', hint: 'install Node.js' }],
        provision: [{ kind: 'npm-install', packages: ['@mermaid-js/mermaid-cli@11'], requires: 'npm' }],
        cliHint: 'node plugins/mermaid/setup.mjs',
      },
    });
    const r = await installAvailablePlugin('mmd', {
      bundledDir, userDir, runProbe: () => false, runNpmInstall: () => { npmRan = true; return okNpm(); },
    });
    expect(npmRan).toBe(false); // never attempted without its prerequisite
    expect(r.status).toBe('needs-setup');
    expect(r.provisioned[0]).toMatchObject({ ok: false, skipped: true });
    expect(r.instructions.some((i) => i.includes('install Node.js'))).toBe(true);
  });

  it('reports a failed fetch as an instruction (no crash)', async () => {
    writeBundled('puml', { install: { provision: [{ kind: 'fetch', url: 'https://x/j.jar', dest: 'j.jar' }] } });
    const r = await installAvailablePlugin('puml', { bundledDir, userDir, fetchBytes: () => { throw new Error('HTTP 503'); } });
    expect(r.status).toBe('needs-setup');
    expect(r.provisioned[0]).toMatchObject({ ok: false, skipped: false });
    expect(r.instructions.some((i) => i.includes('HTTP 503'))).toBe(true);
    expect(existsSync(join(userDir, 'puml', 'j.jar'))).toBe(false);
  });

  it('fails a fetch whose sha256 does not match', async () => {
    writeBundled('puml', { install: { provision: [{ kind: 'fetch', url: 'https://x/j.jar', dest: 'j.jar', sha256: 'deadbeef' }] } });
    const r = await installAvailablePlugin('puml', { bundledDir, userDir, fetchBytes: okFetch });
    expect(r.provisioned[0].ok).toBe(false);
    expect(r.provisioned[0].detail).toContain('checksum');
    expect(existsSync(join(userDir, 'puml', 'j.jar'))).toBe(false);
  });

  it('errors cleanly for an unknown / non-bundled id', async () => {
    const r = await installAvailablePlugin('nope', { bundledDir, userDir });
    expect(r.status).toBe('error');
    expect(r.installed).toBe(false);
    expect(r.error).toBeDefined();
  });

  it('re-install preserves an already-provisioned asset (non-destructive copy)', async () => {
    writeBundled('mmd', {
      install: { requirements: [{ id: 'npm', label: 'npm', command: 'npm', hint: 'x' }], provision: [{ kind: 'npm-install', packages: ['p'] }] },
    });
    // First install without npm: only the bundle is copied.
    await installAvailablePlugin('mmd', { bundledDir, userDir, runProbe: () => false });
    // Simulate the user having provisioned node_modules out-of-band.
    mkdirSync(join(userDir, 'mmd', 'node_modules'), { recursive: true });
    writeFileSync(join(userDir, 'mmd', 'node_modules', 'marker'), 'kept');
    // Re-install (still no npm): the bundle is re-copied but node_modules survives.
    await installAvailablePlugin('mmd', { bundledDir, userDir, runProbe: () => false });
    expect(readFileSync(join(userDir, 'mmd', 'node_modules', 'marker'), 'utf8')).toBe('kept');
  });
});
