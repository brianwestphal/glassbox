/**
 * Ground-truth screenshot regression — capture harness (GB-995).
 *
 * Boots Glassbox for each scene in `scenes.ts`, drives the UI into the pinned
 * state, and writes one PNG per scene. The PNGs feed Glassbox's OWN doc-26
 * ground-truth comparison: the committed `baseline/` images are the "expected"
 * and a fresh `actuals/` capture is the "actual", reviewed via
 * `glassbox --ground-truth ground-truth-screenshots/manifest.json` and promoted
 * with `glassbox ground-truth promote`.
 *
 *   npm run gt:capture                 # write actuals/ (compare against baseline)
 *   npm run gt:capture -- --baseline   # (re)generate the committed baseline/ set
 *   npm run gt:capture -- --only diff-code-split,diff-code-unified
 *   npm run gt:review                  # open the GT review on the LAST-captured actuals (no re-capture)
 *   npm run gt:capture-review          # capture actuals, then open the GT review
 *   npm run gt:promote                 # copy the reviewed actuals over the baselines (then commit baseline/)
 *
 * Like the demo capture scripts, this MUST run OUTSIDE the command sandbox —
 * Chromium needs Mach ports / IPC the sandbox blocks.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { launchChromium } from 'domotion-svg';
import type { Browser } from '@playwright/test';

import { nextFreePort } from '../lib/freePort.js';
import { SCENES, type Scene, type SceneRepo } from './scenes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const GT_DIR = resolve(ROOT, 'ground-truth-screenshots');
const BASELINE_DIR = join(GT_DIR, 'baseline');
const ACTUALS_DIR = join(GT_DIR, 'actuals');
const MANIFEST_PATH = join(GT_DIR, 'manifest.json');

// Fixed viewport + scale → the same layout every run. Pixel diffs across
// machines still see font/AA differences, so baselines should be generated and
// compared in a consistent environment (see docs/ground-truth-screenshots.md).
const VIEWPORT = { width: 1280, height: 800 };

// Isolated global config so the capture never reads/writes the developer's real
// ~/.glassbox (mirrors the e2e suite + demo capture, GB-923).
const CONFIG_DIR = join(tmpdir(), `glassbox-gt-config-${String(process.pid)}`);

/** Resolve the checkout a scene launches inside. `self` is this repo; the
 *  `glassbox-testing` fixture repo is the gitignored `external/glassbox-testing`
 *  clone (override with GLASSBOX_TESTING_REPO). Seed it via
 *  `scripts/ground-truth/build-testing-fixtures.sh`. */
function repoRoot(repo: SceneRepo): string {
  if (repo === 'self') return ROOT;
  const fromEnv = process.env.GLASSBOX_TESTING_REPO;
  if (fromEnv !== undefined && fromEnv.trim() !== '') return resolve(fromEnv);
  return resolve(ROOT, 'external', 'glassbox-testing');
}

function waitForServer(base: string): Promise<void> {
  return (async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(base, { signal: AbortSignal.timeout(1000) });
        if (res.ok) return;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Glassbox never came up on ${base}`);
  })();
}

function spawnGlassbox(scene: Scene, port: number, dataDir: string): ChildProcessByStdio<null, Readable, Readable> {
  const tsxBin = resolve(ROOT, 'node_modules/.bin/tsx');
  const cliPath = resolve(ROOT, 'src/cli.ts');
  const server = spawn(
    tsxBin,
    [
      cliPath,
      ...scene.args,
      '--no-open',
      '--strict-port',
      '--ai-service-test',
      '--port', String(port),
      '--data-dir', dataDir,
    ],
    { cwd: repoRoot(scene.repo), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GLASSBOX_CONFIG_DIR: CONFIG_DIR } },
  );
  const tag = `[${scene.slug}]`;
  server.stdout.on('data', (d) => process.stdout.write(`${tag} ${String(d)}`));
  server.stderr.on('data', (d) => process.stderr.write(`${tag} ${String(d)}`));
  return server;
}

async function killServer(server: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  if (server.killed) return;
  await new Promise<void>((done) => {
    server.once('exit', () => { done(); });
    server.kill('SIGTERM');
    setTimeout(() => { if (!server.killed) server.kill('SIGKILL'); }, 2000);
  });
}

async function captureScene(scene: Scene, port: number, outDir: string): Promise<void> {
  // 127.0.0.1, not `localhost`: the server binds `127.0.0.1` while Node resolves
  // `localhost` to IPv6 `::1` first, so a dual-stack squatter on `::1` would
  // answer the probe instead of our server. (See `capture-demo.ts` for the full
  // rationale.)
  const base = `http://127.0.0.1:${String(port)}`;
  const pngPath = join(outDir, `${scene.slug}.png`);
  console.log(`\n▸ ${scene.label}  (${scene.featureArea})  →  ${pngPath}`);

  const dataDir = mkdtempSync(join(tmpdir(), `glassbox-gt-data-${scene.slug}-`));
  const server = spawnGlassbox(scene, port, dataDir);
  let browser: Browser | null = null;
  try {
    await waitForServer(base);
    browser = await launchChromium();
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    // Wait for the client to hydrate the file list before driving the UI —
    // `networkidle` can resolve before the app JS finishes rendering, which
    // otherwise makes the first `.file-name` click in a scene flakily time out.
    await page.waitForSelector('.file-item, .image-diff, .gt-step-nav', { timeout: 20000 }).catch(() => undefined);
    await scene.setup(page, base);
    // `animations: 'disabled'` is a determinism control, not a cosmetic one:
    // it rewinds infinite CSS animations to their first frame and fast-forwards
    // finite ones, so an element that happens to be animating when the shot is
    // taken lands on the same pixels every run. Without it the sidebar's
    // "Guided review…" analysis spinner was caught at a different rotation
    // angle each capture, giving several scenes a permanent few-pixel delta
    // that no baseline rotation could ever settle — and a noise floor that
    // would hide a genuine sub-pixel regression. Same motivation as the fixed
    // viewport + device scale factor above.
    await page.screenshot({ path: pngPath, fullPage: false, animations: 'disabled' });
    await ctx.close();
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await killServer(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

/** Regenerate the doc-26 manifest from the scene list. Each scene is one
 *  comparison: expected = committed baseline, actual = freshly-captured image.
 *  `expectedKind: "previous-actual"` so `glassbox ground-truth promote` rotates
 *  the baseline to the current actual when the user accepts a UI change. Paths
 *  are relative to the manifest dir (`ground-truth-screenshots/`). */
function writeManifest(scenes: Scene[]): void {
  const manifest = {
    version: 1 as const,
    comparisons: scenes.map(s => ({
      actual: `actuals/${s.slug}.png`,
      expected: `baseline/${s.slug}.png`,
      label: `${s.label} — ${s.featureArea}`,
      expectedKind: 'previous-actual' as const,
    })),
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n✓ Wrote manifest (${String(scenes.length)} comparison(s)) → ${MANIFEST_PATH}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const baseline = argv.includes('--baseline');
  const onlyArg = argv.find(a => a.startsWith('--only='))?.slice('--only='.length)
    ?? (argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined);
  const only = onlyArg ? new Set(onlyArg.split(',').map(s => s.trim())) : null;

  const scenes = only ? SCENES.filter(s => only.has(s.slug)) : SCENES;
  if (scenes.length === 0) {
    console.error(only ? `No scenes matched --only ${onlyArg ?? ''}` : 'No scenes defined.');
    process.exit(1);
  }

  const outDir = baseline ? BASELINE_DIR : ACTUALS_DIR;
  mkdirSync(outDir, { recursive: true });
  mkdirSync(CONFIG_DIR, { recursive: true });
  console.log(`Capturing ${String(scenes.length)} scene(s) into ${baseline ? 'baseline/' : 'actuals/'}`);

  // One server at a time, walking up from just above the dev/e2e range. The
  // scan skips ports already in use: the range is wide enough (one port per
  // scene) that an unrelated local process squatting inside it is a real
  // possibility, and because the server is launched with --strict-port that
  // used to fail exactly one scene with a bare EADDRINUSE — easy to miss in a
  // 47-scene run, and it silently leaves a stale actual behind to be compared.
  // A scene failure is otherwise collected and reported, not fatal — one flaky
  // scene must not block the rest of the (large) capture run.
  let port = 4196;
  const failed: { slug: string; error: string }[] = [];
  for (const scene of scenes) {
    try {
      port = await nextFreePort(port);
      await captureScene(scene, port++, outDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      console.error(`\n✗ ${scene.slug} FAILED: ${msg}`);
      failed.push({ slug: scene.slug, error: msg });
    }
  }

  // The manifest always reflects the full scene list (so the GT review covers
  // every scene), regardless of an --only capture.
  writeManifest(SCENES);
  rmSync(CONFIG_DIR, { recursive: true, force: true });

  const ok = scenes.length - failed.length;
  console.log(`\n✓ Captured ${String(ok)}/${String(scenes.length)} scene(s).`);
  if (failed.length > 0) {
    console.log('✗ Failed scenes:');
    for (const f of failed) console.log(`   - ${f.slug}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
