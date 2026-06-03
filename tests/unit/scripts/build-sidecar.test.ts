import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// GB-853 — guard against the desktop sidecar dropping `cli-difftool.js`.
// Running the actual `bash scripts/build-sidecar.sh` is too slow for a unit
// test (downloads Node, copies node_modules) and requires the bundle to be
// up to date; instead these tests assert the *intent* — that the script
// names every file the desktop install needs at the top level of
// `src-tauri/server/`, and that `tauri.conf.json` ships the corresponding
// shim resources. A future "cleanup pass" that drops one of these lines
// will fail loudly here.
// fileURLToPath, not `new URL(...).pathname`: on Windows the latter yields
// `/C:/...` (a spurious leading slash before the drive letter), which every
// readFileSync below would then reject.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sidecarScript = readFileSync(join(repoRoot, 'scripts/build-sidecar.sh'), 'utf-8');
const tauriConf = JSON.parse(readFileSync(join(repoRoot, 'src-tauri/tauri.conf.json'), 'utf-8'));
const macLauncherShim = readFileSync(join(repoRoot, 'src-tauri/resources/glassbox'), 'utf-8');

describe('build-sidecar.sh', () => {
  it('copies cli.js into the sidecar server dir', () => {
    expect(sidecarScript).toMatch(/cp\s+dist\/cli\.js\s+"\$SERVER_DIR\/"/);
  });

  it('copies cli-difftool.js into the sidecar server dir (GB-853)', () => {
    // The wrapper resolves `cli.js` via `import.meta.url` and so MUST sit
    // next to it. If this line ever goes away, desktop-install users will
    // get "command not found" when running `git difftool`.
    expect(sidecarScript).toMatch(/cp\s+dist\/cli-difftool\.js\s+"\$SERVER_DIR\/"/);
  });

  it('copies svg-rasterize-worker.js into the sidecar server dir', () => {
    expect(sidecarScript).toMatch(/cp\s+dist\/svg-rasterize-worker\.js\s+"\$SERVER_DIR\/"/);
  });
});

describe('tauri.conf.json bundle.resources', () => {
  const resources: string[] = tauriConf.bundle.resources;

  it('ships the platform glassbox shims', () => {
    expect(resources).toContain('resources/glassbox');
    expect(resources).toContain('resources/glassbox-linux');
    expect(resources).toContain('resources/glassbox.cmd');
  });

  it('ships the platform glassbox-difftool shims (GB-853)', () => {
    // If any of these are missing, the desktop "Install CLI" command will
    // fail at the bundle-not-found check inside `install_cli`.
    expect(resources).toContain('resources/glassbox-difftool');
    expect(resources).toContain('resources/glassbox-difftool-linux');
    expect(resources).toContain('resources/glassbox-difftool.cmd');
  });
});

describe('macOS glassbox launcher shim', () => {
  it('blocks on the server PID when GLASSBOX_DIFFTOOL_BLOCK is set (GB-855)', () => {
    // The difftool wrapper sets this env var and relies on the shim waiting for
    // the review window to close. If this `wait` goes away, the desktop
    // difftool launch becomes fire-and-forget and tears down its temp snapshot
    // mid-session.
    expect(macLauncherShim).toContain('GLASSBOX_DIFFTOOL_BLOCK');
    expect(macLauncherShim).toMatch(/wait\s+"\$NODE_PID"/);
  });
});
