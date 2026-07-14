import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  compareVersions,
  hashPluginDir,
  installBundledPlugins,
  installPluginFromDisk,
  readDismissed,
  shouldInstall,
  uninstallPlugin,
} from '../../../src/plugins/install.js';

let cfg: string;
let bundled: string;
let userDir: string;

beforeEach(() => {
  cfg = mkdtempSync(join(tmpdir(), 'gb-cfg-'));
  bundled = mkdtempSync(join(tmpdir(), 'gb-bundled-'));
  // userDir is <config>/plugins; the dismiss-list lives next to it (in <config>).
  userDir = join(cfg, 'plugins');
});
afterEach(() => {
  rmSync(cfg, { recursive: true, force: true });
  rmSync(bundled, { recursive: true, force: true });
});

/** Write a plugin dir (manifest + index.js) under `root`. */
function makePlugin(root: string, id: string, version: string, body = '// plugin'): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, name: id, version, entry: 'index.js' }));
  writeFileSync(join(dir, 'index.js'), body);
  return dir;
}

describe('version compare + hashing', () => {
  it('compareVersions orders dotted numeric versions', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9', '1.0.0')).toBe(-1);
  });

  it('hashPluginDir changes when content changes', () => {
    const a = makePlugin(bundled, 'p', '1.0.0', 'A');
    const h1 = hashPluginDir(a);
    writeFileSync(join(a, 'index.js'), 'B');
    expect(hashPluginDir(a)).not.toBe(h1);
  });
});

describe('shouldInstall freshness (doc 29 FR-29.7)', () => {
  it('installs when the destination is missing', () => {
    const src = makePlugin(bundled, 'p', '1.0.0');
    expect(shouldInstall(src, join(userDir, 'p'), '1.0.0')).toBe(true);
  });

  it('reinstalls when the bundled version is newer', () => {
    const src = makePlugin(bundled, 'p', '2.0.0');
    makePlugin(userDir, 'p', '1.0.0');
    expect(shouldInstall(src, join(userDir, 'p'), '2.0.0')).toBe(true);
  });

  it('leaves a newer installed copy alone', () => {
    const src = makePlugin(bundled, 'p', '1.0.0');
    makePlugin(userDir, 'p', '2.0.0');
    expect(shouldInstall(src, join(userDir, 'p'), '1.0.0')).toBe(false);
  });

  it('reinstalls a same-version-but-byte-different rebuild', () => {
    const src = makePlugin(bundled, 'p', '1.0.0', 'NEW BYTES');
    makePlugin(userDir, 'p', '1.0.0', 'OLD BYTES');
    expect(shouldInstall(src, join(userDir, 'p'), '1.0.0')).toBe(true);
  });

  it('skips an identical same-version install', () => {
    const src = makePlugin(bundled, 'p', '1.0.0', 'SAME');
    makePlugin(userDir, 'p', '1.0.0', 'SAME');
    expect(shouldInstall(src, join(userDir, 'p'), '1.0.0')).toBe(false);
  });
});

describe('installBundledPlugins (doc 29 FR-29.7)', () => {
  it('copies bundled plugins into the user dir', () => {
    makePlugin(bundled, 'graphviz', '1.0.0');
    installBundledPlugins({ bundledDir: bundled, userDir });
    expect(existsSync(join(userDir, 'graphviz', 'index.js'))).toBe(true);
    expect(existsSync(join(userDir, 'graphviz', 'manifest.json'))).toBe(true);
  });

  it('is a no-op when the bundled dir is absent', () => {
    installBundledPlugins({ bundledDir: join(bundled, 'nope'), userDir });
    expect(existsSync(userDir)).toBe(false);
  });

  it('does NOT auto-install a plugin marked autoInstall:false (separately installable, GB-1046)', () => {
    // A normal plugin installs; the opt-in one (e.g. PlantUML) is skipped.
    makePlugin(bundled, 'graphviz', '1.0.0');
    const optIn = join(bundled, 'plantuml');
    mkdirSync(optIn, { recursive: true });
    writeFileSync(join(optIn, 'manifest.json'), JSON.stringify({ id: 'plantuml', name: 'PlantUML', version: '1.0.0', entry: 'index.js', autoInstall: false }));
    writeFileSync(join(optIn, 'index.js'), '// plantuml');
    installBundledPlugins({ bundledDir: bundled, userDir });
    expect(existsSync(join(userDir, 'graphviz'))).toBe(true);
    expect(existsSync(join(userDir, 'plantuml'))).toBe(false);
  });

  it('skips a dismissed plugin', () => {
    makePlugin(bundled, 'graphviz', '1.0.0');
    makePlugin(userDir, 'graphviz', '1.0.0'); // installed
    uninstallPlugin('graphviz', { userDir }); // removes + dismisses
    installBundledPlugins({ bundledDir: bundled, userDir });
    expect(existsSync(join(userDir, 'graphviz'))).toBe(false);
    expect(readDismissed(userDir)).toContain('graphviz');
  });

  it('upgrades an older installed copy but not a newer one', () => {
    makePlugin(bundled, 'p', '2.0.0', 'v2');
    makePlugin(userDir, 'p', '1.0.0', 'v1');
    makePlugin(bundled, 'q', '1.0.0', 'bundled-q');
    makePlugin(userDir, 'q', '5.0.0', 'user-q');
    installBundledPlugins({ bundledDir: bundled, userDir });
    expect(readFileSync(join(userDir, 'p', 'index.js'), 'utf8')).toBe('v2'); // upgraded
    expect(readFileSync(join(userDir, 'q', 'index.js'), 'utf8')).toBe('user-q'); // left alone
  });
});

describe('install-from-disk + uninstall (doc 29, GB-1040 mechanism)', () => {
  it('symlinks a plugin dir into the user dir and clears its dismiss', () => {
    const src = makePlugin(bundled, 'graphviz', '1.0.0');
    uninstallPlugin('graphviz', { userDir }); // dismiss it first
    expect(readDismissed(userDir)).toContain('graphviz');
    const { id } = installPluginFromDisk(src, { userDir });
    expect(id).toBe('graphviz');
    expect(existsSync(join(userDir, 'graphviz', 'manifest.json'))).toBe(true);
    expect(readlinkSync(join(userDir, 'graphviz'))).toBe(src); // symlinked
    expect(readDismissed(userDir)).not.toContain('graphviz'); // un-dismissed
  });

  it('rejects a directory with no manifest', () => {
    const bad = join(bundled, 'notaplugin');
    mkdirSync(bad, { recursive: true });
    expect(() => installPluginFromDisk(bad, { userDir })).toThrow(/manifest/);
  });
});
