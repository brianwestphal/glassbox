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
 * Outputs land under `assets/`, named to match the references already in the
 * README (`demo-guided-review`, `demo-risk-mode`, `demo-narrative-mode`,
 * `demo-annotations`, `demo-settings`, `demo-direct-comparison`).
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
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

interface Scenario {
  /** `--demo:N` scenario id (see `src/demo.ts` DEMO_SCENARIOS). */
  id: number;
  /** Output filename base — produces `assets/demo-<slug>.png` and `…/demo-<slug>.svg`. */
  slug: string;
  /** Human-readable label for log output. */
  label: string;
  /** Drive the page into the state worth screenshotting after the home page loads. */
  setup: (page: Page, base: string) => Promise<void>;
}

const TARGET_FILE = 'src/auth/session.ts';

async function openFile(page: Page, path: string): Promise<void> {
  await page.click(`.file-name[title="${path}"]`);
  await page.waitForSelector(`.diff-view[data-file-path="${path}"]`, { timeout: 15000 });
}

const SCENARIOS: Scenario[] = [
  {
    id: 1,
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
    id: 2,
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
    id: 3,
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
    id: 4,
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
    id: 5,
    slug: 'settings',
    label: 'Settings dialog with guided review',
    async setup(page) {
      await page.click('.settings-gear');
      await page.waitForSelector('.settings-dialog', { timeout: 5000 });
      // Guided review lives under the Experimental tab; click it if present.
      const tab = page.locator('[data-tab="experimental"]');
      if (await tab.count() > 0) await tab.first().click();
      await page.waitForTimeout(300);
    },
  },
  {
    id: 6,
    slug: 'direct-comparison',
    label: 'Direct comparison (--diff) of two folders',
    async setup(page) {
      // The visible difference is the `compare: A ↔ B` sidebar label; open a
      // file so the screenshot shows both the label and a relative-path diff.
      await openFile(page, TARGET_FILE);
    },
  },
  {
    id: 7,
    slug: 'review-notes',
    label: 'AI review notes inline with the diff',
    async setup(page) {
      // session.ts carries the illustrative AI review notes (rationale / proof /
      // risk / outdated) plus the threaded human reply; wait for them to render.
      await openFile(page, TARGET_FILE);
      await page.waitForSelector('.ai-note-review', { timeout: 10000 });
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

function spawnDemoServer(scenarioId: number, port: number): ChildProcessByStdio<null, Readable, Readable> {
  const tsxBin = resolve(ROOT, 'node_modules/.bin/tsx');
  const server = spawn(
    tsxBin,
    [
      'src/cli.ts',
      `--demo:${String(scenarioId)}`,
      '--no-open',
      '--strict-port',
      '--ai-service-test',
      '--port', String(port),
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GLASSBOX_CONFIG_DIR: DEMO_CONFIG_DIR } },
  );
  const tag = `[demo:${String(scenarioId)}]`;
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
  const base = `http://localhost:${String(port)}`;
  console.log(`\n▸ ${scenario.label}  →  assets/demo-${scenario.slug}.{png,svg}`);

  const server = spawnDemoServer(scenario.id, port);
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

    await ctx.close();
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await killServer(server);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  // One demo at a time on a known free port — keeps server lifecycle simple
  // and avoids glyph-cache cross-talk between scenarios. Starting just above
  // the default 4183 keeps it out of the way of any open dev/e2e servers.
  let port = 4191;
  for (const scenario of SCENARIOS) {
    await captureOne(scenario, port++);
  }
  console.log(`\n✓ Captured ${String(SCENARIOS.length)} scenarios. PNG + SVG outputs in ${OUT_DIR}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
