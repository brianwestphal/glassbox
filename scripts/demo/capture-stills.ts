/**
 * Regenerates the static demo screenshots referenced from `README.md`.
 *
 * Run it whenever the UI changes in a way the README screenshots should
 * reflect, or when a new demo scenario is added:
 *
 *   npm run demo:capture-stills
 *
 * For each `--demo:N` scenario (see `src/demo.ts`) the script:
 *   1. Boots a real Glassbox server (`tsx src/cli.ts --demo:N …`) on a free port
 *   2. Opens it in Chromium via Playwright
 *   3. Runs scenario-specific in-app navigation to put the UI in the showcased
 *      state (open a file, switch sort mode, open the settings dialog, …)
 *   4. Captures both a **PNG** (`page.screenshot`) and a **stand-alone SVG**
 *      (via `domotion-svg`'s `captureElementTree` + `elementTreeToSvg`)
 *
 * Outputs land under `assets/`, named to match the README references
 * (`demo-guided-review`, `demo-risk-mode`, `demo-narrative-mode`,
 * `demo-annotations`, `demo-settings`,
 * `demo-review-notes`, `demo-image-comparison`, `demo-ground-truth`). Scenes
 * marked `pngOnly` (the image / ground-truth ones, whose live canvas/`<img>`
 * content doesn't serialize cleanly) skip the stand-alone SVG.
 *
 * Note: the *animated* hero (`assets/demo.svg`) is produced by the separate
 * `npm run demo:capture` (see `capture-demo.ts`) and is unrelated to this
 * script. Per the GB-835 brief, these stills don't try to animate anything
 * — they're single-frame snapshots of each scenario.
 *
 * Like `capture-demo.ts`, this MUST run OUTSIDE the command sandbox because
 * Chromium needs Mach ports / IPC the sandbox blocks.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  captureElementTree,
  clearEmbeddedFonts,
  elementTreeToSvg,
  launchChromium,
  optimizeSvg,
  setRenderTextMode,
} from 'domotion-svg';
import type { Browser, Page } from '@playwright/test';

import { nextFreePort } from '../lib/freePort.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const OUT_DIR = resolve(ROOT, 'assets');

// Isolate the demo server's GLOBAL config under a disposable pid-scoped dir via
// GLASSBOX_CONFIG_DIR (mirrors the e2e suite, GB-923). Without this the capture
// reads the developer's real `~/.glassbox/config.json`, so the settings
// screenshot bakes in whatever AI platform/model that machine happens to have
// selected — non-reproducible across machines. A fresh empty dir gives every
// run the deterministic default platform (`anthropic`) while `--ai-service-test`
// still surfaces the full 5-platform picker (Local / Apple included).
const DEMO_CONFIG_DIR = join(tmpdir(), `glassbox-stills-config-${String(process.pid)}`);
mkdirSync(DEMO_CONFIG_DIR, { recursive: true });

const VIEWPORT = { width: 1280, height: 800 };

/** Link an opt-in (not auto-installed) plugin from the machine's real
 *  `~/.glassbox/plugins/` into the capture config dir. Plugin discovery is
 *  symlink-aware, so a link is enough — and avoids copying e.g. mermaid's
 *  Chromium-backed node_modules. Returns false (skip the scenario, with a
 *  warning) when the plugin isn't installed on this machine. */
function linkOptInPlugin(id: string): boolean {
  const source = join(homedir(), '.glassbox', 'plugins', id);
  if (!existsSync(join(source, 'manifest.json'))) {
    console.warn(`⚠ skipping: the '${id}' plugin is not installed on this machine (expected ${source}; run plugins/${id}/setup.mjs)`);
    return false;
  }
  const linkDir = join(DEMO_CONFIG_DIR, 'plugins');
  mkdirSync(linkDir, { recursive: true });
  const link = join(linkDir, id);
  if (!existsSync(link)) symlinkSync(source, link);
  return true;
}

interface Scenario {
  /** Mode-defining CLI args for the Glassbox launch — usually `['--demo:N']`
   *  (see `src/demo.ts` DEMO_SCENARIOS), but also e.g. `['--ground-truth', …]`.
   *  The harness adds `--no-open --strict-port --ai-service-test --port`. */
  launchArgs: string[];
  /** Output filename base — produces `assets/demo-<slug>.png` and `…/demo-<slug>.svg`. */
  slug: string;
  /** Human-readable label for log output. */
  label: string;
  /** Drive the page into the state worth screenshotting after the home page loads. */
  setup: (page: Page, base: string) => Promise<void>;
  /** Skip the stand-alone SVG capture (PNG only). Set for image/canvas-heavy
   *  scenes whose live `<img>`/canvas content doesn't serialize cleanly to SVG. */
  pngOnly?: boolean;
  /** Pre-boot hook (e.g. link an opt-in plugin into the capture config dir).
   *  Return false to skip the scenario with a warning instead of failing. */
  prepare?: () => boolean;
}

const TARGET_FILE = 'src/auth/session.ts';
const DEMO_IMAGE = 'src-tauri/icons/128x128.png';

async function openFile(page: Page, path: string): Promise<void> {
  await page.click(`.file-name[title="${path}"]`);
  await page.waitForSelector(`.diff-view[data-file-path="${path}"]`, { timeout: 15000 });
}

const SCENARIOS: Scenario[] = [
  {
    launchArgs: ["--demo:1"],
    slug: 'guided-review',
    label: 'Main UI with guided review notes',
    async setup(page) {
      // Guided notes load asynchronously into the store after page load and
      // only inject when a file is opened; give them time to populate.
      await page.waitForTimeout(4500);
      await openFile(page, TARGET_FILE);
      await page.waitForSelector('.ai-note-guided', { timeout: 10000 });
    },
  },
  {
    launchArgs: ["--demo:2"],
    slug: 'risk-mode',
    label: 'Risk mode with inline risk notes',
    async setup(page, base) {
      // Risk-score badges are off by default; flip them on so the sidebar
      // shows the colored aggregate badges that make this screenshot useful.
      await fetch(`${base}/api/ai/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_risk_scores: true, risk_sort_dimension: 'aggregate' }),
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.risk-badge', { timeout: 12000 });
      await openFile(page, TARGET_FILE);
      // Inline risk notes are async; tolerate absence rather than fail.
      await page.waitForSelector('.ai-note-risk', { timeout: 8000 }).catch(() => undefined);
    },
  },
  {
    launchArgs: ["--demo:3"],
    slug: 'narrative-mode',
    label: 'Narrative mode with walkthrough notes',
    async setup(page) {
      // Scenario 3 already sets sort_mode = 'narrative' server-side. Wait
      // for the position chips, then open a file to show the walkthrough.
      await page.waitForSelector('.narrative-position', { timeout: 10000 });
      await openFile(page, TARGET_FILE);
      await page.waitForSelector('.ai-note-narrative', { timeout: 8000 }).catch(() => undefined);
    },
  },
  {
    launchArgs: ["--demo:4"],
    slug: 'annotations',
    label: 'Annotations with different categories',
    async setup(page) {
      // session.ts carries three annotations — bug, fix, pattern-follow —
      // the best variety to capture in one screenshot.
      await openFile(page, TARGET_FILE);
      await page.waitForSelector('.annotation-row', { timeout: 15000 });
    },
  },
  {
    launchArgs: ["--demo:5"],
    slug: 'settings',
    label: 'Settings dialog with guided review',
    async setup(page) {
      await page.click('.settings-gear');
      // The dialog renders a loading spinner (`.settings-loading`) while its
      // async data load runs, then swaps in the real shell. Wait for the tabs,
      // not the outer `.settings-dialog` (which is present during loading too),
      // or the capture can fire mid-spinner.
      await page.waitForSelector('.settings-tabs', { timeout: 5000 });
      // Guided review lives under the Experimental tab; click it if present.
      const tab = page.locator('[data-tab="experimental"]');
      if (await tab.count() > 0) await tab.first().click();
      await page.waitForTimeout(300);
    },
  },
  // (No still for `--diff` / demo scenario 6: its only visible difference is
  // the `compare: A ↔ B` sidebar label, which never earned a README reference.
  // The scenario itself stays for hands-on demoing.)
  {
    launchArgs: ["--demo:7"],
    slug: 'review-notes',
    label: 'AI review notes inline with the diff',
    async setup(page) {
      // session.ts carries the illustrative AI review notes (rationale / proof /
      // risk / outdated) plus the threaded human reply; wait for them to render.
      await openFile(page, TARGET_FILE);
      await page.waitForSelector('.ai-note-review', { timeout: 10000 });
    },
  },
  {
    launchArgs: ["--demo:4"],
    slug: 'image-comparison',
    label: 'Image diff — difference overlay',
    pngOnly: true,
    async setup(page) {
      // demo:4 seeds a binary image diff (icons/128x128.png, renamed from
      // 64x64). Open it and switch to the difference overlay — the standout
      // image-review feature that's only described in text in the README.
      await page.click(`.file-name[title="${DEMO_IMAGE}"]`);
      await page.waitForSelector('.image-diff', { timeout: 15000 });
      await page.click('[data-image-mode="difference"]');
      await page.waitForTimeout(900);
    },
  },
  {
    launchArgs: ["--diff", "scripts/demo/fixtures/diagram-diff/old", "scripts/demo/fixtures/diagram-diff/new"],
    slug: 'plugin-rendered',
    label: 'Diagram source diffed as an image (graphviz plugin, Code | Rendered)',
    pngOnly: true,
    async setup(page) {
      // The graphviz plugin (auto-installed from dist/plugins) handles .dot, so
      // the file gets the Code | Rendered toggle (doc 29 FR-29.2). Flip to
      // Rendered: both sides render to SVG and the image viewer opens in the
      // doc-24 side-by-side layout — the old and new pipeline diagrams.
      await openFile(page, 'deploy-pipeline.dot');
      await page.click('[data-svg-mode="rendered"]');
      await page.waitForSelector('.image-diff', { timeout: 15000 });
      // Wait for both plugin-rendered sides to actually decode.
      await page.waitForFunction(() => {
        const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.image-diff img'));
        return imgs.length >= 2 && imgs.every((img) => img.complete && img.naturalWidth > 0);
      }, null, { timeout: 15000 });
      await page.waitForTimeout(500);
    },
  },
  {
    launchArgs: ["--demo:7"],
    slug: 'plugin-mermaid-note',
    label: 'Mermaid proof artifact rendered inline (mermaid plugin)',
    pngOnly: true,
    prepare: () => linkOptInPlugin('mermaid'),
    async setup(page) {
      // Scenario 7's proof note carries a .mmd sequence-diagram artifact; with
      // the mermaid plugin present it renders inline as a diagram (doc 29).
      await openFile(page, TARGET_FILE);
      await page.waitForSelector('.ai-note-artifact-img', { timeout: 30000 });
      // Scroll the proof note into view so the still centers on the diagram.
      await page.locator('.ai-note-row[data-kind="proof"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    },
  },
  {
    launchArgs: ["--ground-truth", "tests/fixtures/ground-truth/manifest.json"],
    slug: 'ground-truth',
    label: 'Ground-truth image comparison',
    pngOnly: true,
    async setup(page) {
      // Ground-truth mode (doc 26): the named source list with difference-score
      // badges + the Expected/Actual comparison of the first entry. Tolerate a
      // raced selector wait — the page auto-loads, so settle and snap regardless.
      await page.waitForSelector('.image-diff, .file-item', { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
    },
  },
];

function waitForServer(base: string): Promise<void> {
  return (async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(base, { signal: AbortSignal.timeout(1000) });
        if (res.ok) return;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Glassbox demo server never came up on ${base}`);
  })();
}

function spawnStillServer(scenario: Scenario, port: number, dataDir: string): ChildProcessByStdio<null, Readable, Readable> {
  const tsxBin = resolve(ROOT, 'node_modules/.bin/tsx');
  const server = spawn(
    tsxBin,
    [
      'src/cli.ts',
      ...scenario.launchArgs,
      '--no-open',
      '--strict-port',
      '--ai-service-test',
      '--port', String(port),
      // Honored by non-demo modes (e.g. --ground-truth); demo mode overrides it
      // with its own tmp dir, so this is harmless there.
      '--data-dir', dataDir,
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GLASSBOX_CONFIG_DIR: DEMO_CONFIG_DIR } },
  );
  const tag = `[${scenario.slug}]`;
  server.stdout.on('data', (d) => process.stdout.write(`${tag} ${String(d)}`));
  server.stderr.on('data', (d) => process.stderr.write(`${tag} ${String(d)}`));
  return server;
}

async function killServer(server: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  if (server.killed) return;
  await new Promise<void>((done) => {
    server.once('exit', () => { done(); });
    server.kill('SIGTERM');
    // Belt-and-braces: SIGKILL if it doesn't honor SIGTERM in two seconds.
    setTimeout(() => { if (!server.killed) server.kill('SIGKILL'); }, 2000);
  });
}

async function captureOne(scenario: Scenario, port: number): Promise<void> {
  // 127.0.0.1, not `localhost`: the server binds `127.0.0.1` while Node resolves
  // `localhost` to IPv6 `::1` first, so a dual-stack squatter on `::1` would
  // answer the probe instead of our server. (See `capture-demo.ts` for the full
  // rationale.)
  const base = `http://127.0.0.1:${String(port)}`;
  console.log(`\n▸ ${scenario.label}  →  assets/demo-${scenario.slug}.{png,svg}`);

  const dataDir = mkdtempSync(resolve(tmpdir(), `glassbox-stills-${scenario.slug}-`));
  const server = spawnStillServer(scenario, port, dataDir);
  let browser: Browser | null = null;

  try {
    await waitForServer(base);
    browser = await launchChromium();
    // Record a HAR alongside the PNG + SVG for each scenario. Gitignored
    // (see `.gitignore`) — useful for debugging the network activity that
    // produced the screenshot, not as a committed artifact.
    const harPath = resolve(OUT_DIR, `demo-${scenario.slug}.har`);
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      recordHar: { path: harPath },
    });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });

    await scenario.setup(page, base);
    // Settle layout / late paints (highlight.js, font swap, …) before snapping.
    await page.waitForTimeout(600);

    const pngPath = resolve(OUT_DIR, `demo-${scenario.slug}.png`);
    await page.screenshot({ path: pngPath, fullPage: false });

    if (scenario.pngOnly !== true) {
      // Embedded-font glyph state must be cleared between scenarios; otherwise a
      // later capture inherits an earlier scenario's glyph defs.
      clearEmbeddedFonts();
      setRenderTextMode('paths');

      const tree = await captureElementTree(page, 'body', {
        x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height,
      });
      // domotion-svg 0.6.0: `elementTreeToSvg` now returns a complete SVG
      // document (the old inner-markup behavior is `elementTreeToSvgInner`).
      const svg = elementTreeToSvg(tree, VIEWPORT.width, VIEWPORT.height);
      const svgPath = resolve(OUT_DIR, `demo-${scenario.slug}.svg`);
      writeFileSync(svgPath, optimizeSvg(svg));
    }

    await ctx.close();
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await killServer(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  // Optional `--only slug1,slug2` filter for iterating on a single still.
  const onlyArg = process.argv.slice(2).find(a => a.startsWith('--only='))?.slice('--only='.length)
    ?? (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined);
  const only = onlyArg ? new Set(onlyArg.split(',').map(s => s.trim())) : null;
  const scenarios = only ? SCENARIOS.filter(s => only.has(s.slug)) : SCENARIOS;

  // One demo at a time, walking up from just above the default 4183 (out of the
  // way of any open dev/e2e servers). Each scenario takes the first free port
  // at/above the cursor via `nextFreePort`, so an unrelated process squatting in
  // the range costs a port rather than failing the scene with a cryptic
  // "server never came up" (the `--strict-port` server would bind nothing and
  // the probe would hit the squatter). A scene failure is collected, not fatal,
  // so one flaky capture doesn't drop the rest of the set.
  let port = 4191;
  const failed: string[] = [];
  const skipped: string[] = [];
  for (const scenario of scenarios) {
    try {
      if (scenario.prepare?.() === false) { skipped.push(scenario.slug); continue; }
      port = await nextFreePort(port);
      await captureOne(scenario, port++);
    } catch (err) {
      console.error(`\n✗ ${scenario.slug} FAILED: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      failed.push(scenario.slug);
    }
  }
  console.log(`\n✓ Captured ${String(scenarios.length - failed.length - skipped.length)}/${String(scenarios.length)} scenarios. Outputs in ${OUT_DIR}`);
  if (skipped.length > 0) console.log(`⚠ Skipped (missing prerequisites): ${skipped.join(', ')}`);
  if (failed.length > 0) { console.log(`✗ Failed: ${failed.join(', ')}`); process.exit(1); }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
