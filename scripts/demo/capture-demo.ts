/**
 * Regenerates `assets/demo.svg` (+ `assets/demo.svgz`) — the animated hero at
 * the top of the README. Run it whenever the UI changes in a way the demo
 * should reflect:
 *
 *   npm run demo:capture
 *
 * Storyboard (one infinitely-looping SVG, framed in faux browser/terminal
 * window chrome with a caption band):
 *   1. AI risk triage — sidebar in risk mode, colored risk badges
 *   2. browse a file, then open the `src/auth/session.ts` split diff (with
 *      guided "Learn" notes and a pre-seeded `remember` annotation)
 *   3. click line 23, type a bug annotation, save it
 *   4. complete the review
 *   5. peek at the exported `.glassbox/latest-review.md`
 *   6. a mocked Claude Code terminal runs `/glassbox`, applies the fix, tests pass
 *   7. the loop closes on the fixed diff
 *   8. a branded end card
 * An on-screen cursor glides between targets (with click pulses) through the
 * Glassbox beats and hides for the terminal/markdown/end-card scenes.
 *
 * Trees are captured live, then rendered to SVG AFTER the browser + server are
 * torn down — domotion's macOS glyph-path extraction is flaky under contention
 * and silently falls back to CSS `<text>` (tofu); rendering once everything else
 * is gone makes path mode reliable, and we assert it at the end.
 *
 * Requires Chromium (Playwright) + `domotion-svg` (pinned 0.3.3 for path-mode
 * text). MUST run OUTSIDE the command sandbox (Chromium needs Mach ports).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  captureElementTree,
  clearEmbeddedFonts,
  cullElementsOutsideViewBox,
  elementTreeToSvgInner,
  generateAnimatedSvg,
  getEmbeddedFontFaceCss,
  gzipSvg,
  launchChromium,
  optimizeSvg,
  setRenderTextMode,
} from 'domotion-svg';
import type { AnimationFrame, CursorEvent, Overlay } from 'domotion-svg';
import type { Browser, Page } from '@playwright/test';

import {
  CANVAS_H,
  CANVAS_W,
  type ChromeKind,
  chromeWrap,
  CONTENT_H,
  CONTENT_W,
  OX,
  OY,
} from './chrome.js';
import { endCardSvg, markdownPeekHtml, PROMPT_ANCHOR_ID, terminalSceneHtml } from './scenes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const OUT_SVG = resolve(ROOT, 'assets/demo.svg');
const OUT_SVGZ = resolve(ROOT, 'assets/demo.svgz');
const DEBUG_DIR = resolve(__dirname, '.debug');
const EXPORT_MD = resolve(ROOT, '.glassbox/latest-review.md');

const PORT = 4188;
const BASE = `http://localhost:${String(PORT)}`;

const TARGET_FILE = 'src/auth/session.ts';
const BROWSE_FILE = 'src/db/redis.ts';
const TARGET_LINE = 23; // the unsanitized Redis key — flagged as a bug
const FEEDBACK = 'Sanitize the session id before building the Redis key.';
const REMEMBER_LINE = 16; // `const refreshToken = randomBytes(48)…`
const REMEMBER = 'Always generate session tokens with a CSPRNG like randomBytes — never Math.random().';
const TYPING_SPEED = 42;

// Browser-window title used for all Glassbox frames.
const APP_TITLE = 'Glassbox  ·  localhost:4183';
const TERM_TITLE = 'claude — demo-project — zsh';

type CapturedTree = Awaited<ReturnType<typeof captureElementTree>>;

/** A frame captured live; rendered to SVG only after browser/server teardown. */
interface FrameJob {
  /** Captured tree rendered at CONTENT size + wrapped in chrome … */
  tree: CapturedTree | null;
  /** … OR a pre-built full-canvas SVG (the end card, which is chrome-less). */
  fullSvg?: string;
  prefix: string;
  chrome?: { title: string; kind: ChromeKind; caption?: string };
  meta: Omit<AnimationFrame, 'svgContent'>;
}

interface Hit { cx: number; cy: number }
interface ClickSpec { frame: number; offset: number; hit: Hit }

function center(b: { x: number; y: number; width: number; height: number }): Hit {
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

/** Shift a content-space point into canvas space (content is inset by the chrome). */
function shift(h: Hit): Hit {
  return { cx: h.cx + OX, cy: h.cy + OY };
}

function transitionMs(f: AnimationFrame): number {
  if (f.transition == null) return 300;
  if (f.transition.type === 'cut') return 0;
  return f.transition.duration;
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Glassbox demo server never came up on ${BASE}`);
}

async function grabTree(page: Page): Promise<CapturedTree> {
  return captureElementTree(page, 'body', { x: 0, y: 0, width: CONTENT_W, height: CONTENT_H });
}

async function openFile(page: Page, path: string): Promise<void> {
  await page.click(`.file-name[title="${path}"]`);
  await page.waitForSelector(`.diff-view[data-file-path="${path}"]`, { timeout: 15000 });
}

async function sidebarHit(page: Page, path: string): Promise<Hit> {
  const b = await page.locator(`.file-name[title="${path}"]`).boundingBox();
  if (b === null) throw new Error(`sidebar row not found: ${path}`);
  return center(b);
}

// --- main -----------------------------------------------------------------

async function main(): Promise<void> {
  rmSync(DEBUG_DIR, { recursive: true, force: true });
  mkdirSync(DEBUG_DIR, { recursive: true });
  mkdirSync(dirname(OUT_SVG), { recursive: true });

  const tsxBin = resolve(ROOT, 'node_modules/.bin/tsx');
  const server = spawn(
    tsxBin,
    ['src/cli.ts', '--demo:1', '--no-open', '--strict-port', '--ai-service-test', '--port', String(PORT)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  server.stdout.on('data', d => process.stdout.write(`[server] ${String(d)}`));
  server.stderr.on('data', d => process.stderr.write(`[server] ${String(d)}`));

  let browser: Browser | null = null;
  let shot = 0;
  const debugShot = async (page: Page, name: string): Promise<void> => {
    await page.screenshot({ path: resolve(DEBUG_DIR, `${String(shot++).padStart(2, '0')}-${name}.png`) });
  };

  const jobs: FrameJob[] = [];
  const clickSpecs: ClickSpec[] = [];
  let prefix = 0;
  const nextPrefix = (): string => `f${String(prefix++)}-`;

  // Push a Glassbox/terminal/markdown frame (chrome-wrapped at compose time).
  const pushChrome = (tree: CapturedTree, chrome: FrameJob['chrome'], meta: FrameJob['meta']): number => {
    jobs.push({ tree, prefix: nextPrefix(), chrome, meta });
    return jobs.length - 1;
  };

  let typeEnd = 0;
  let markdown = '';
  let promptAnchor = { x: 0, y: 0, fontSize: 14 };

  try {
    await waitForServer();
    // Risk-score badges are off by default in demo:1; enable them before the
    // page loads so the client initializes risk mode with visible badges.
    await fetch(`${BASE}/api/ai/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show_risk_scores: true, risk_sort_dimension: 'aggregate' }),
    });
    browser = await launchChromium();
    const ctx = await browser.newContext({ viewport: { width: CONTENT_W, height: CONTENT_H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();

    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Let guided "Learn" notes load into the store before opening files (they
    // only inject on a fresh file-open).
    await page.waitForTimeout(5500);

    // Seed a `remember` annotation so the diff shows category variety + the
    // "persist a rule to CLAUDE.md" feature (rendered when the file opens).
    await page.evaluate(async (a) => {
      const fr = await fetch('/api/files').then(r => r.json() as Promise<{ files: { id: string; file_path: string }[] }>);
      const rf = fr.files.find(f => f.file_path === a.file);
      if (!rf) return;
      await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewFileId: rf.id, lineNumber: a.line, side: 'new', category: 'remember', content: a.content }),
      });
    }, { file: TARGET_FILE, line: REMEMBER_LINE, content: REMEMBER });

    // === 1. Risk triage ===================================================
    await page.click('button[data-sort-mode="risk"]');
    await page.waitForSelector('.risk-badge', { timeout: 12000 });
    await page.waitForTimeout(700);
    const browseHit = await sidebarHit(page, BROWSE_FILE);
    await debugShot(page, 'risk');
    clickSpecs.push({
      frame: pushChrome(await grabTree(page), { title: APP_TITLE, kind: 'browser', caption: 'AI scores every file’s risk' },
        { duration: 2000, transition: { type: 'crossfade', duration: 260 } }),
      offset: 1400, hit: browseHit,
    });

    // === 2. Browse a file, then open the target diff ======================
    await openFile(page, BROWSE_FILE);
    await page.waitForTimeout(500);
    const targetHit = await sidebarHit(page, TARGET_FILE);
    await debugShot(page, 'browse');
    clickSpecs.push({
      frame: pushChrome(await grabTree(page), { title: APP_TITLE, kind: 'browser', caption: 'Browse the changes' },
        { duration: 1500, transition: { type: 'crossfade', duration: 260 } }),
      offset: 1000, hit: targetHit,
    });

    await openFile(page, TARGET_FILE);
    await page.waitForSelector('.ai-note-guided', { timeout: 10000 });
    const lineSel = `.diff-line.split-right[data-side="new"][data-line="${String(TARGET_LINE)}"]`;
    await page.waitForSelector(lineSel, { timeout: 15000 });
    await page.locator(lineSel).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const lineBox = await page.locator(lineSel).boundingBox();
    if (lineBox === null) throw new Error('target line not visible');
    await debugShot(page, 'diff');
    clickSpecs.push({
      frame: pushChrome(await grabTree(page), { title: APP_TITLE, kind: 'browser', caption: 'Review with AI “Learn” notes' },
        { duration: 2600, transition: { type: 'crossfade', duration: 260 } }),
      offset: 1800, hit: center(lineBox),
    });

    // === 3. Annotate line 23 (type wrapped feedback) ======================
    await page.click(lineSel, { position: { x: 60, y: lineBox.height / 2 } });
    await page.waitForSelector('.annotation-form-container textarea', { timeout: 5000 });
    await page.waitForTimeout(250);
    const field = await page.evaluate(() => {
      const el = document.querySelector<HTMLTextAreaElement>('.annotation-form-container textarea');
      if (!el) return null;
      el.placeholder = '';
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const padL = parseFloat(cs.paddingLeft);
      const padR = parseFloat(cs.paddingRight);
      const padT = parseFloat(cs.paddingTop);
      return { x: r.x + padL, y: r.y + padT, w: r.width - padL - padR, fontSize: parseFloat(cs.fontSize), color: cs.color, bg: cs.backgroundColor };
    });
    if (field === null) throw new Error('annotation textarea not found');

    const saveBox = await page.locator('.annotation-form-container .annotation-save-btn').boundingBox();
    if (saveBox === null) throw new Error('save button not found');

    const baseDelay = 250;
    typeEnd = baseDelay + FEEDBACK.length * TYPING_SPEED;
    // One typing overlay: domotion wraps to bgWidth like a textarea (DM-840) and
    // renders a blinking insertion caret (DM-870) — no manual line-splitting.
    const typingOverlay: Overlay = {
      kind: 'typing', text: FEEDBACK,
      x: field.x + OX, y: field.y + OY + field.fontSize * 0.9,
      fontSize: field.fontSize, color: field.color, speed: TYPING_SPEED,
      delay: baseDelay, bgColor: field.bg, bgWidth: field.w, bgHeight: field.fontSize * 1.5,
      caret: true,
    };

    await debugShot(page, 'form');
    clickSpecs.push({
      frame: pushChrome(await grabTree(page), { title: APP_TITLE, kind: 'browser', caption: 'Leave a note for your AI' },
        { duration: typeEnd + 1100, transition: { type: 'crossfade', duration: 260 }, overlays: [typingOverlay] }),
      offset: typeEnd + 550, hit: center(saveBox),
    });

    // === 4. Save + complete ===============================================
    await page.fill('.annotation-form-container textarea', FEEDBACK);
    await page.click('.annotation-form-container .annotation-save-btn');
    await page.waitForSelector('.annotation-item', { timeout: 5000 });
    await page.waitForTimeout(400);
    const completeBox = await page.locator('#complete-review').boundingBox();
    if (completeBox === null) throw new Error('complete-review button not found');
    await debugShot(page, 'saved');
    clickSpecs.push({
      frame: pushChrome(await grabTree(page), { title: APP_TITLE, kind: 'browser', caption: 'A bug to fix — and a rule to remember' },
        { duration: 1700, transition: { type: 'crossfade', duration: 260 } }),
      offset: 1150, hit: center(completeBox),
    });

    await page.click('#complete-review');
    await page.waitForSelector('.modal-copyable', { timeout: 8000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const first = document.querySelector('.modal-copyable');
      if (first) first.textContent = '.glassbox/latest-review.md';
    });
    await debugShot(page, 'modal');
    pushChrome(await grabTree(page), { title: APP_TITLE, kind: 'browser', caption: 'Finish — feedback is exported' },
      { duration: 2300, transition: { type: 'push-left', duration: 320 } });

    // Read the freshly-exported markdown for the peek frame.
    try { markdown = readFileSync(EXPORT_MD, 'utf-8'); }
    catch { markdown = '# Code Review\n\n## File Annotations\n\n### src/auth/session.ts\n\n- **Line 23** [bug]: ' + FEEDBACK; }

    // === loop-close frame (fix applied + annotation resolved) =============
    const doneBtn = page.locator('[data-action="modal-done"]');
    if (await doneBtn.count() > 0) await doneBtn.first().click();
    await page.waitForTimeout(200);
    await page.evaluate((line) => {
      document.querySelectorAll('.annotation-row, .annotation-form-container, .annotation-count').forEach(el => { el.remove(); });
      const reopen = document.getElementById('reopen-review');
      if (reopen) { reopen.textContent = 'Complete Review'; reopen.id = 'complete-review'; }
      const code = document.querySelector(`.diff-line.split-right[data-side="new"][data-line="${String(line)}"] .code`);
      if (code) code.textContent = "  await redis.set(`session:${encodeURIComponent(id)}`, JSON.stringify(session), 'EX', SESSION_TTL);";
    }, TARGET_LINE);
    await page.locator(lineSel).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await debugShot(page, 'loop');
    const loopJob: FrameJob = {
      tree: await grabTree(page), prefix: nextPrefix(),
      chrome: { title: APP_TITLE, kind: 'browser', caption: 'The loop closes — issue resolved' },
      meta: { duration: 2200, transition: { type: 'crossfade', duration: 360 } },
    };

    // === 5. Markdown peek (separate page) =================================
    const aux = await ctx.newPage();
    await aux.setViewportSize({ width: CONTENT_W, height: CONTENT_H });
    await aux.setContent(markdownPeekHtml({ width: CONTENT_W, height: CONTENT_H, markdown }));
    await aux.waitForTimeout(150);
    await debugShot(aux, 'markdown');
    const markdownJob: FrameJob = {
      tree: await grabTree(aux), prefix: nextPrefix(),
      chrome: { title: '.glassbox/latest-review.md', kind: 'browser', caption: 'Exported as structured markdown your AI reads' },
      meta: { duration: 2600, transition: { type: 'push-left', duration: 320 } },
    };

    // === 6. Terminal scenes ==============================================
    await aux.setContent(terminalSceneHtml({ width: CONTENT_W, height: CONTENT_H, stage: 'prompt' }));
    await aux.waitForTimeout(150);
    const anchor = await aux.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, fontSize: parseFloat(getComputedStyle(document.body).fontSize) };
    }, PROMPT_ANCHOR_ID);
    if (anchor === null) throw new Error('terminal prompt anchor not found');
    promptAnchor = anchor;
    await debugShot(aux, 'term-prompt');
    const termPromptJob: FrameJob = {
      tree: await grabTree(aux), prefix: nextPrefix(),
      chrome: { title: TERM_TITLE, kind: 'terminal', caption: 'Hand the review to Claude Code' },
      meta: {
        duration: 1700, transition: { type: 'crossfade', duration: 240 },
        overlays: [{
          kind: 'typing', text: '/glassbox',
          x: promptAnchor.x + OX, y: promptAnchor.y + OY + promptAnchor.fontSize * 0.9,
          fontSize: promptAnchor.fontSize, color: '#79c0ff', speed: 55, delay: 300, caret: true,
        }],
      },
    };

    await aux.setContent(terminalSceneHtml({ width: CONTENT_W, height: CONTENT_H, stage: 'working' }));
    await aux.waitForTimeout(150);
    await debugShot(aux, 'term-working');
    const termWorkingJob: FrameJob = {
      tree: await grabTree(aux), prefix: nextPrefix(),
      chrome: { title: TERM_TITLE, kind: 'terminal', caption: 'It reads the review…' },
      meta: { duration: 1800, transition: { type: 'crossfade', duration: 240 } },
    };

    await aux.setContent(terminalSceneHtml({ width: CONTENT_W, height: CONTENT_H, stage: 'done' }));
    await aux.waitForTimeout(150);
    await debugShot(aux, 'term-done');
    const termDoneJob: FrameJob = {
      tree: await grabTree(aux), prefix: nextPrefix(),
      chrome: { title: TERM_TITLE, kind: 'terminal', caption: '…applies the fix, and tests pass' },
      meta: { duration: 3000, transition: { type: 'push-left', duration: 320 } },
    };

    // Assemble final order.
    jobs.push(markdownJob, termPromptJob, termWorkingJob, termDoneJob, loopJob);
    const endJobIndex = jobs.length; // appended after render

    // === Teardown, then render ============================================
    await browser.close();
    browser = null;
    server.kill('SIGTERM');

    // Pin the text mode so a future domotion default change can't silently
    // break the demo (v0.4.0's switch to embedded-font once rendered as tofu).
    setRenderTextMode('embedded-font');
    clearEmbeddedFonts();
    const frames: AnimationFrame[] = jobs.map(j => {
      const tree = j.tree as CapturedTree;
      // Drop elements outside the content viewport (diff lines below the fold,
      // scrolled-off sidebar rows) — the window chrome clips them anyway, but
      // they'd still emit glyphs into the embedded font. Static frames don't
      // scroll, so we mutate the tree and discard the returned cull keyframes.
      cullElementsOutsideViewBox(tree, CONTENT_W, CONTENT_H, undefined, 0, 1);
      // includeGlyphDefs=false → per-frame font CSS is also suppressed; the
      // embedded-font @font-face is collected once below for the whole SVG.
      return {
        ...j.meta,
        svgContent: chromeWrap(elementTreeToSvgInner(tree, CONTENT_W, CONTENT_H, j.prefix, false), {
          title: j.chrome?.title ?? '', kind: j.chrome?.kind ?? 'browser', id: j.prefix, caption: j.chrome?.caption,
        }),
      };
    });
    // End card: full-canvas hand-built SVG, no chrome, no glyph capture.
    frames.push({
      svgContent: endCardSvg(CANVAS_W, CANVAS_H),
      duration: 2400, transition: { type: 'crossfade', duration: 380 },
    });
    const fontFaceCss = getEmbeddedFontFaceCss(); // base64 font subset, hoisted once

    // === Cursor track =====================================================
    const frameStart: number[] = [];
    { let acc = 0; for (const f of frames) { frameStart.push(acc); acc += f.duration + transitionMs(f); } }
    const MOVE_MS = 420;
    const DWELL = 160;
    const cursorEvents: CursorEvent[] = [{ type: 'show', t: 0, x: OX + CONTENT_W * 0.18, y: OY + CONTENT_H * 0.3 }];
    for (const c of clickSpecs) {
      const clickT = frameStart[c.frame] + c.offset;
      const hit = shift(c.hit);
      cursorEvents.push({ type: 'move', t: Math.max(0, clickT - DWELL - MOVE_MS), duration: MOVE_MS, to: { x: hit.cx, y: hit.cy } });
      cursorEvents.push({ type: 'click', t: clickT });
    }
    // Hide for the markdown/terminal/end-card scenes; reappear on the loop frame.
    const markdownIdx = jobs.length - 5; // markdownJob's position in `jobs`
    const loopIdx = jobs.length - 1; // loopJob is last in `jobs`
    cursorEvents.push({ type: 'hide', t: frameStart[markdownIdx] });
    cursorEvents.push({ type: 'show', t: frameStart[loopIdx], x: OX + CONTENT_W * 0.5, y: OY + CONTENT_H * 0.5 });
    cursorEvents.push({ type: 'hide', t: frameStart[endJobIndex] });

    let svg = generateAnimatedSvg({
      width: CANVAS_W, height: CANVAS_H, frames, fontFaceCss,
      cursorOverlay: { events: cursorEvents, style: { cursorScale: 1.6 } },
    });
    writeFileSync(resolve(DEBUG_DIR, '_raw.svg'), svg);
    try {
      svg = optimizeSvg(svg);
    } catch (e) {
      console.warn(`optimizeSvg failed (${(e as Error).message}); shipping unoptimized.`);
    }

    // domotion 0.5.0 renders captured text via an embedded @font-face subset
    // (carried in the SVG), so it renders identically anywhere. Guard that the
    // font actually got embedded — without it the text would render as tofu.
    if (!svg.includes('@font-face')) {
      throw new Error('No embedded @font-face in the output — captured text would render as tofu. Check domotion text mode.');
    }

    const gz = gzipSvg(svg);
    writeFileSync(OUT_SVG, svg);
    writeFileSync(OUT_SVGZ, gz);
    const texts = (svg.match(/<text\b/g) ?? []).length;
    console.log(`\n✓ Wrote ${OUT_SVG} (${(svg.length / 1024).toFixed(1)} KB, ${String(texts)} text runs, embedded font)`);
    console.log(`✓ Wrote ${OUT_SVGZ} (${(gz.length / 1024).toFixed(1)} KB gzipped)`);
    console.log(`  ${String(frames.length)} frames · debug screenshots in ${DEBUG_DIR}`);
  } finally {
    if (browser !== null) await browser.close().catch(() => undefined);
    server.kill('SIGTERM');
    setTimeout(() => server.kill('SIGKILL'), 2000).unref();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => { console.error(err); process.exit(1); },
);
