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

  it('copies channel.js into the sidecar server dir (GB-887)', () => {
    // The Claude MCP channel server. `channel-config.ts` (bundled into cli.js)
    // resolves it as a sibling of cli.js via `import.meta.url`, so it MUST sit
    // next to cli.js. If this line goes away, the channel toggle writes a
    // `.mcp.json` pointing at a missing file and the channel silently fails to
    // launch in desktop installs.
    expect(sidecarScript).toMatch(/cp\s+dist\/channel\.js\s+"\$SERVER_DIR\/"/);
  });
});

// GB-887 — the desktop channel broke because tsup kept `@modelcontextprotocol/sdk`
// external but `build-sidecar.sh` never copied it into the sidecar's node_modules,
// and never copied the `channel.js` entry either. These tests parse both files and
// assert they stay in sync, so the next external dep or server entry point that
// gets added to `tsup.config.ts` can't silently go missing from the sidecar.
describe('build-sidecar.sh ⇄ tsup.config.ts consistency (GB-887)', () => {
  const tsupConfig = readFileSync(join(repoRoot, 'tsup.config.ts'), 'utf-8');

  // The package names in the `for pkg in … ; do` copy loop.
  const copiedPackages = (() => {
    const m = /for pkg in ([^;]+);/.exec(sidecarScript);
    if (m === null) throw new Error('could not find the `for pkg in …` copy loop in build-sidecar.sh');
    return m[1].trim().split(/\s+/);
  })();

  // The external-package prefixes from tsup's noExternal negative-lookahead regex
  // (`/^(?!@electric-sql|hono|…)/`): everything matching one of these prefixes is
  // kept external and so must be copied into the sidecar.
  const externalPrefixes = (() => {
    const m = /\(\?!([^)]+)\)/.exec(tsupConfig);
    if (m === null) throw new Error('could not find the noExternal negative-lookahead in tsup.config.ts');
    return m[1].split('|').map(p => p.trim()).filter(Boolean);
  })();

  it.each(externalPrefixes)('copies a package matching external prefix "%s"', (prefix) => {
    // Each tsup-external prefix must be satisfied by at least one copied package.
    // `@modelcontextprotocol` had no matching copy line before GB-887.
    expect(copiedPackages.some(pkg => pkg === prefix || pkg.startsWith(prefix + '/'))).toBe(true);
  });

  // The server-bundle entry-point names (the keys of the first config's `entry`
  // object) → each is emitted as `dist/<name>.js` and the ones spawned as
  // siblings must be copied next to cli.js.
  const serverEntries = (() => {
    const block = /entry:\s*\{([\s\S]*?)\}/.exec(tsupConfig);
    if (block === null) throw new Error('could not find the server `entry` object in tsup.config.ts');
    return [...block[1].matchAll(/^\s*['"]?([\w-]+)['"]?\s*:/gm)].map(m => m[1]);
  })();

  it.each(serverEntries)('copies the "%s" server entry into the sidecar', (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(sidecarScript).toMatch(new RegExp(`cp\\s+dist/${escaped}\\.js\\s+"\\$SERVER_DIR/"`));
  });
});

// GB-918 — the Apple FM helper compiles only on macOS 26, but the bundle build
// runs on macOS 15, so CI passes the prebuilt, signed helper in via
// GLASSBOX_PREBUILT_APPLE_FM_HELPER. These assert the supply contract stays
// intact: the script honors the prebuilt path, falls back to compiling locally,
// bundles whichever it ends up with, and the env-var name stays in sync with the
// release workflows that set it.
describe('build-sidecar.sh ⇄ Apple FM helper supply (GB-918)', () => {
  it('uses the prebuilt helper when GLASSBOX_PREBUILT_APPLE_FM_HELPER is set', () => {
    expect(sidecarScript).toMatch(/GLASSBOX_PREBUILT_APPLE_FM_HELPER/);
  });

  it('falls back to compiling the helper locally when no prebuilt is supplied', () => {
    expect(sidecarScript).toMatch(/build-apple-fm-helper\.sh/);
  });

  it('bundles the resolved helper into the sidecar server dir', () => {
    expect(sidecarScript).toMatch(/cp\s+"\$HELPER_SRC"\s+"\$SERVER_DIR\/apple-fm-helper"/);
  });

  it.each([
    'release-desktop.yml',
    'release-candidate.yml',
  ])('release workflow %s sets GLASSBOX_PREBUILT_APPLE_FM_HELPER for the arm64 build', (wf) => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows', wf), 'utf-8');
    expect(workflow).toMatch(/GLASSBOX_PREBUILT_APPLE_FM_HELPER/);
    // …and provides the artifact it points at via a dedicated macOS-26 job.
    expect(workflow).toMatch(/runs-on:\s*macos-26/);
    expect(workflow).toMatch(/name:\s*apple-fm-helper/);
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
