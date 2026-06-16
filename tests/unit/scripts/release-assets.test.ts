import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// GB-871 — the GitHub Releases page links each platform to its installer, and
// a separate workflow step renames the raw Tauri .dmg filenames to friendly
// names. The bug class this guards against: a download link that 404s because
// it points at a name the rename step never produces (or vice-versa). Both
// halves live in scripts/release/release-assets.mjs so they share one source
// of truth; these tests pin that they always agree.
//
// fileURLToPath, not `new URL(...).pathname`: on Windows the latter yields
// `/C:/...` (a spurious leading slash before the drive letter).
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const modUrl = new URL('../../../scripts/release/release-assets.mjs', import.meta.url).href;
const { friendlyName, shippedAssetNames, downloadEntries, downloadSection } = await import(modUrl);

const VERSION = '1.2.3';
const REPO = 'brianwestphal/glassbox';
const TAG = 'v1.2.3';

describe('release-assets friendlyName', () => {
  it('renames the Apple Silicon .dmg to a dash-separated friendly name', () => {
    expect(friendlyName('Glassbox_1.2.3_aarch64.dmg')).toBe('Glassbox-1.2.3-macOS-Apple-Silicon.dmg');
  });

  it('renames the Intel .dmg to a dash-separated friendly name', () => {
    expect(friendlyName('Glassbox_1.2.3_x64.dmg')).toBe('Glassbox-1.2.3-macOS-Intel.dmg');
  });

  it('leaves non-.dmg installers untouched (latest.json references them by original name)', () => {
    for (const name of [
      'Glassbox_1.2.3_amd64.deb',
      'Glassbox_1.2.3_amd64.AppImage',
      'Glassbox-1.2.3-1.x86_64.rpm',
      'Glassbox_1.2.3_x64-setup.exe',
      'Glassbox_1.2.3_x64_en-US.msi',
      'Glassbox.app.tar.gz',
      'latest.json',
    ]) {
      expect(friendlyName(name)).toBe(name);
    }
  });

  it('is idempotent — renaming an already-friendly name is a no-op', () => {
    const renamed = friendlyName('Glassbox_1.2.3_aarch64.dmg');
    expect(friendlyName(renamed)).toBe(renamed);
  });
});

describe('release-assets download links resolve to shipped assets', () => {
  it('every linked filename is an asset name the rename step actually produces', () => {
    const shipped = new Set(shippedAssetNames(VERSION));
    const entries = downloadEntries(VERSION);
    const linked = Object.values(entries).flat().map((e: { file: string }) => e.file);

    expect(linked.length).toBeGreaterThan(0);
    for (const file of linked) {
      expect(shipped, `download link "${file}" has no matching shipped asset`).toContain(file);
    }
  });

  it('macOS links point to the renamed friendly .dmg names', () => {
    const files = downloadEntries(VERSION).macOS.map((e: { file: string }) => e.file);
    expect(files).toContain(`Glassbox-${VERSION}-macOS-Apple-Silicon.dmg`);
    expect(files).toContain(`Glassbox-${VERSION}-macOS-Intel.dmg`);
  });

  it('Linux and Windows links point to the original (un-renamed) installer names', () => {
    const linux = downloadEntries(VERSION).Linux.map((e: { file: string }) => e.file);
    const windows = downloadEntries(VERSION).Windows.map((e: { file: string }) => e.file);
    expect(linux).toContain(`Glassbox_${VERSION}_amd64.AppImage`);
    expect(windows).toContain(`Glassbox_${VERSION}_x64-setup.exe`);
  });
});

describe('release-assets downloadSection markdown', () => {
  const body = downloadSection(VERSION, REPO, TAG);

  it('opens with a Download heading and per-platform sections', () => {
    expect(body).toMatch(/^## Download/);
    expect(body).toContain('### macOS');
    expect(body).toContain('### Linux');
    expect(body).toContain('### Windows');
  });

  it('embeds the tag-scoped release-download base URL for every link', () => {
    const base = `https://github.com/${REPO}/releases/download/${TAG}/`;
    const linked = Object.values(downloadEntries(VERSION)).flat() as { file: string }[];
    for (const { file } of linked) {
      expect(body).toContain(`${base}${file}`);
    }
  });

  it('includes the npm install line with the version substituted', () => {
    expect(body).toContain(`npm install -g glassbox@${VERSION}`);
  });
});

describe('release-desktop.yml wiring', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/release-desktop.yml'), 'utf-8');

  it('builds the release body from the shared module (not an inline stub)', () => {
    expect(workflow).toMatch(/release-assets\.mjs download-section/);
    // The old generic fallback must be gone — its presence meant the page had
    // no real download summary.
    expect(workflow).not.toContain('See the assets below to download and install.');
  });

  it('drives the asset rename from the shared module', () => {
    expect(workflow).toMatch(/friendlyName/);
    expect(workflow).toMatch(/release-assets\.mjs/);
  });

  it('publishes only after assets are renamed (no broken-link window)', () => {
    expect(workflow).toMatch(/needs:\s*\[create-release,\s*build,\s*rename-assets\]/);
  });
});
