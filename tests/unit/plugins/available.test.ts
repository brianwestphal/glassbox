import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { describeAvailablePlugin, listAvailablePlugins } from '../../../src/plugins/available.js';
import type { PluginManifest } from '../../../src/plugins/manifest.js';

// doc 29 §29.2 (GB-1069) — the "available to install" list.
describe('listAvailablePlugins', () => {
  let root: string;
  let bundledDir: string;
  let userDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gb-avail-'));
    bundledDir = join(root, 'bundled');
    userDir = join(root, 'user');
    mkdirSync(bundledDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const writeBundled = (id: string, manifest: Partial<PluginManifest>): void => {
    const dir = join(bundledDir, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, name: id, version: '1.0.0', ...manifest }));
  };

  it('lists an opt-in (autoInstall:false) bundled plugin that is not installed', () => {
    writeBundled('plantuml', { name: 'PlantUML', autoInstall: false, contentTypes: [{ extensions: ['.puml'] }] });
    const list = listAvailablePlugins({ bundledDir, userDir, runProbe: () => true });
    expect(list.map((a) => a.id)).toEqual(['plantuml']);
    expect(list[0].extensions).toEqual(['.puml']);
  });

  it('excludes auto-install plugins (they are seeded automatically)', () => {
    writeBundled('graphviz', { autoInstall: true });
    writeBundled('deffault', {}); // autoInstall omitted → auto-install
    expect(listAvailablePlugins({ bundledDir, userDir, runProbe: () => true })).toEqual([]);
  });

  it('excludes an opt-in plugin that is already installed', () => {
    writeBundled('plantuml', { autoInstall: false });
    mkdirSync(join(userDir, 'plantuml'), { recursive: true }); // already installed
    expect(listAvailablePlugins({ bundledDir, userDir, runProbe: () => true })).toEqual([]);
  });

  it('reports readiness from the probe + carries hints', () => {
    writeBundled('plantuml', {
      autoInstall: false,
      install: { requirements: [{ id: 'java', label: 'Java', command: 'java', checkArgs: ['-version'], hint: 'install a JRE' }] },
    });
    const met = listAvailablePlugins({ bundledDir, userDir, runProbe: () => true })[0];
    expect(met.requirements[0]).toMatchObject({ id: 'java', met: true });
    expect(met.selfContained).toBe(false);

    const unmet = listAvailablePlugins({ bundledDir, userDir, runProbe: () => false })[0];
    expect(unmet.requirements[0]).toMatchObject({ met: false, hint: 'install a JRE' });
  });

  it('marks a no-requirement, no-provision plugin as self-contained', () => {
    writeBundled('codec', { autoInstall: false, contentTypes: [{ extensions: ['.webp'] }] });
    const a = listAvailablePlugins({ bundledDir, userDir, runProbe: () => true })[0];
    expect(a.selfContained).toBe(true);
    expect(a.requirements).toEqual([]);
    expect(a.provisionNotes).toEqual([]);
  });

  it('summarizes provision steps as notes (fetch + npm-install)', () => {
    const manifest = {
      id: 'x', name: 'X', version: '1',
      install: {
        provision: [
          { kind: 'fetch' as const, url: 'https://x/j.jar', dest: 'j.jar' },
          { kind: 'npm-install' as const, packages: ['a', 'b'], note: 'downloads a browser' },
        ],
      },
    };
    const a = describeAvailablePlugin(manifest, () => true);
    expect(a.provisionNotes).toEqual(['Downloads j.jar.', 'downloads a browser']);
    expect(a.selfContained).toBe(false);
  });

  it('sorts the list by name', () => {
    writeBundled('zeta', { name: 'Zeta', autoInstall: false });
    writeBundled('alpha', { name: 'Alpha', autoInstall: false });
    expect(listAvailablePlugins({ bundledDir, userDir, runProbe: () => true }).map((a) => a.name)).toEqual(['Alpha', 'Zeta']);
  });
});
