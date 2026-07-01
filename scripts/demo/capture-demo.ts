/**
 * Regenerates `assets/demo.svg` (+ `assets/demo.svgz`) — the animated hero at
 * the top of the README. Run it whenever the UI changes in a way the demo
 * should reflect:
 *
 *   npm run demo:capture
 *
 * Storyboard (one infinitely-looping SVG; each beat is a rounded browser/
 * terminal window on a transparent canvas with a lower-third caption):
 *   0. CLI launch — a real terminal recording (`domotion term`): `git status -s`
 *      then `npx glassbox`, over whose last frame the live app pops in (layered)
 *   1. AI risk triage — sidebar in risk mode, colored risk badges
 *   2. browse a file, then open the `src/auth/session.ts` split diff (with
 *      guided "Learn" notes and a pre-seeded `remember` annotation)
 *   3. click line 23, type a bug annotation, save it
 *   4. complete the review
 *   5. peek at the exported `.glassbox/latest-review.md`
 *   6. a Claude Code terminal recording (`domotion term`) runs `/glassbox`,
 *      applies the fix, tests pass
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
 * Requires Chromium (Playwright) + `domotion-svg` (pinned 0.18.0; this script
 * renders in embedded-font mode — see `setRenderTextMode('embedded-font')`
 * below). The terminal beats are real `domotion term` cast renders (see
 * `casts.ts`). MUST run OUTSIDE the command sandbox (Chromium needs Mach ports).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  captureElementTree,
  castToTermFrames,
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
import type { AnimationFrame, CursorEvent, TypingOverlay } from 'domotion-svg';
import type { Browser, Page } from '@playwright/test';

import { claudeCast, launchCast } from './casts.js';
import { popInAnimations, popInFrameSvg, popInIds } from './popIn.js';
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
import {
  endCardSvg,
  markdownPeekHtml,
} from './scenes.js';

// Terminal beats are real `domotion term` cast renders (DM-1225), so they read
// as a continuous terminal session (incremental line reveal, a real caret, hard
// cuts between settle points) rather than separate HTML screenshots crossfaded
// together (which looked composited / faded). Grid sized so the widest line —
// the inline-edit diff's `encodeURIComponent` row — fits without wrapping.
const TERM_THEME = { extends: 'dark', bg: '#0d1117', fg: '#c9d1d9' } as const;
const TERM_COLS = 112;
const TERM_FONT_SIZE = 15;
const TERM_PADDING = 30;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const OUT_SVG = resolve(ROOT, 'assets/demo.svg');
const OUT_SVGZ = resolve(ROOT, 'assets/demo.svgz');
const DEBUG_DIR = resolve(__dirname, '.debug');
const EXPORT_MD = resolve(ROOT, '.glassbox/latest-review.md');

// Ephemeral port for the demo server. Overridable via DEMO_PORT so a run can
// dodge a port collision (e.g. a stray `python -m http.server 4188` squatting the
// default), which otherwise makes the browser hit the wrong server and every
// in-page `/api/*` fetch return 404 HTML.
const PORT = Number(process.env.DEMO_PORT) || 4188;
const BASE = `http://localhost:${String(PORT)}`;

// Isolate the demo server's GLOBAL config under a disposable pid-scoped dir via
// GLASSBOX_CONFIG_DIR (mirrors the e2e suite + the stills capture, GB-923) so
// the run doesn't read or mutate the developer's real `~/.glassbox` (scenario 1
// writes the guided-review config server-side).
const DEMO_CONFIG_DIR = join(tmpdir(), `glassbox-demo-config-${String(process.pid)}`);
mkdirSync(DEMO_CONFIG_DIR, { recursive: true });

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
const LAUNCH_TITLE = 'demo-project — zsh';

type CapturedTree = Awaited<ReturnType<typeof captureElementTree>>;

/** A frame captured live; rendered to SVG only after browser/server teardown. */
interface FrameJob {
  /** Captured tree rendered at CONTENT size + wrapped in chrome … */
  tree: CapturedTree | null;
  /** … OR a pre-built full-canvas SVG (the end card; the terminal cast frames,
   *  already rendered to SVG during the session by `castToTermFrames`). */
  fullSvg?: string;
  prefix: string;
  chrome?: { title: string; kind: ChromeKind; caption?: string };
  meta: Omit<AnimationFrame, 'svgContent'>;
  /** When set, this frame is a LAYERED pop-in (see `withPopIn` / `popIn.ts`): the
   *  app window (wrapped in `<g class="anim-<popInId>">`, scale-popped) sits ON TOP
   *  of the previous terminal frame, which is layered behind it (`popInBgSvg`,
   *  wrapped in `<g class="anim-<popInFadeId>">`) and fades out. */
  popInId?: string;
  /** The prior terminal frame's full SVG, layered behind a pop-in app frame and
   *  faded out while the app pops in on top (GB-1016 / GB-1024). */
  popInBgSvg?: string;
  popInFadeId?: string;
}

/** Make an app frame a **layered pop-in** over the previous terminal beat: the app
 *  window is entered via a `cut` (so it's opaque and on top from t=0), scale-pops
 *  from 0.9 → 1, and the terminal frame is layered BEHIND it (`bgTerminalSvg`) and
 *  fades out — the "keep A, pop B on top, fade A behind" reveal the maintainer
 *  asked for (GB-1016 / GB-1024), not a mutual see-through crossfade. The classes
 *  are applied in the compose loop (`popInFrameSvg`); the animations key off them.
 *  Entry-as-cut is owned by the previous (terminal) frame's transition under the
 *  DM-1414 exit-semantics — cast frames all exit via `cut`, so that holds. */
function withPopIn(job: FrameJob, base: string, bgTerminalSvg: string): FrameJob {
  const ids = popInIds(base);
  job.popInId = ids.scaleId;
  job.popInFadeId = ids.fadeId;
  job.popInBgSvg = bgTerminalSvg;
  job.meta.animations = [...(job.meta.animations ?? []), ...popInAnimations(ids)];
  return job;
}

interface Hit { cx: number; cy: number }
/** A click pulse: the app job it lands on (resolved to a frame index at compose
 *  time, so it survives a varying number of terminal cast frames before it) plus
 *  the ms offset into that frame and the content-space target. */
interface ClickSpec { job: FrameJob; offset: number; hit: Hit }

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
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GLASSBOX_CONFIG_DIR: DEMO_CONFIG_DIR } },
  );
  server.stdout.on('data', d => process.stdout.write(`[server] ${String(d)}`));
  server.stderr.on('data', d => process.stderr.write(`[server] ${String(d)}`));

  let browser: Browser | null = null;
  let shot = 0;
  const debugShot = async (page: Page, name: string): Promise<void> => {
    await page.screenshot({ path: resolve(DEBUG_DIR, `${String(shot++).padStart(2, '0')}-${name}.png`) });
  };

  const clickSpecs: ClickSpec[] = [];
  let prefix = 0;
  const nextPrefix = (): string => `f${String(prefix++)}-`;

  // Build a Glassbox/markdown frame job (the captured tree is chrome-wrapped at
  // compose time, after teardown). Returns the job so callers can hold a
  // reference — frame INDICES aren't known until the final order is assembled
  // (terminal cast beats contribute a variable number of frames).
  const mkJob = (tree: CapturedTree, chrome: FrameJob['chrome'], meta: FrameJob['meta']): FrameJob =>
    ({ tree, prefix: nextPrefix(), chrome, meta });

  // Render one terminal beat from an asciinema cast through `castToTermFrames`
  // (the `domotion term` pipeline) into pre-wrapped frame jobs: each settle-point
  // frame is centered on a terminal-bg content area and wrapped in window chrome.
  // EVERY cast frame exits via `cut` — terminals hard-cut between settle points and
  // never crossfade internally (an internal crossfade read as a "weird fade out",
  // GB-1023). The beat's ENTRY transition is NOT set here: under domotion's
  // exit-semantics (DM-1414) a frame's entrance is driven by the PREVIOUS frame's
  // transition, so a terminal beat's entry is owned by the preceding frame's exit
  // (the markdown peek cuts to the Claude terminal — slide-in doesn't engage for
  // cast frames, so a push-left there would leave a transparent gap).
  const renderTermCast = async (
    castText: string, rows: number,
    o: { title: string; caption: string },
  ): Promise<FrameJob[]> => {
    if (browser === null) throw new Error('browser not ready for cast render');
    const { frames, width, height } = await castToTermFrames(castText, browser, {
      theme: TERM_THEME, cols: TERM_COLS, rows, fontSize: TERM_FONT_SIZE,
      padding: TERM_PADDING, cursor: 'block', mode: 'incremental', manageFonts: false,
    });
    // Center horizontally; top-align vertically (a real terminal fills from the
    // top — centering left the shorter launch terminal floating mid-card). A
    // small inset gives breathing room under the title bar.
    const dx = Math.round((CONTENT_W - width) / 2);
    const dy = 16;
    return frames.map((f): FrameJob => {
      const id = nextPrefix();
      const content =
        `<rect x="0" y="0" width="${String(CONTENT_W)}" height="${String(CONTENT_H)}" fill="${TERM_THEME.bg}"/>` +
        `<g transform="translate(${String(dx)}, ${String(dy)})">${f.svgContent}</g>`;
      return {
        tree: null, prefix: id,
        fullSvg: chromeWrap(content, { title: o.title, kind: 'terminal', id, caption: o.caption }),
        meta: { duration: f.duration, transition: f.transition },
      };
    });
  };

  let typeEnd = 0;
  let markdown = '';

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
    // Pin the text mode ONCE, up front — before any frame (terminal cast or app)
    // is rendered to SVG — so a future domotion default change can't silently
    // break the demo (v0.4.0's switch to embedded-font once rendered as tofu).
    // Terminal cast frames render during the session (they need the browser); app
    // frames render after teardown. Both share this one embedded-font builder
    // (cleared once here, collected once at the end), so the base64 font subset
    // appears a single time in the output — hence no `clearEmbeddedFonts()` in
    // the post-teardown render loop, which would drop the terminal glyphs.
    setRenderTextMode('embedded-font');
    clearEmbeddedFonts();
    // Record a HAR alongside the animated SVG output. Gitignored (see
    // `.gitignore`) — useful for debugging the network activity that drove
    // the storyboard, not as a committed artifact.
    const ctx = await browser.newContext({
      viewport: { width: CONTENT_W, height: CONTENT_H },
      deviceScaleFactor: 1,
      recordHar: { path: resolve(ROOT, 'assets/demo.har') },
    });
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

    // === 0. CLI launch ====================================================
    // The opening shell beat is a real terminal recording (domotion term): the
    // user runs `git status -s` then `npx glassbox`, and the CLI reports the
    // review + URL. Its last frame crossfades into the live app below (the
    // "Glassbox appears" beat). Rendered now (needs the browser); spliced FIRST
    // in the final order. The `git status` files match the demo review, so the
    // launch lines up with the diff shown next (no continuity gap).
    const launchJobs = await renderTermCast(launchCast(TERM_COLS, 22), 22, {
      title: LAUNCH_TITLE, caption: 'Launch a review from the CLI',
    });

    // === 1. Risk triage ===================================================
    await page.click('button[data-sort-mode="risk"]');
    await page.waitForSelector('.risk-badge', { timeout: 12000 });
    await page.waitForTimeout(700);
    const browseHit = await sidebarHit(page, BROWSE_FILE);
    await debugShot(page, 'risk');
    // First live-app window: a LAYERED pop-in over the launch terminal — the app
    // sits on top (cut entry) and the terminal fades out behind it (GB-1016). Its
    // OWN transition is the exit to the browse beat: a `cut`, not a crossfade —
    // consecutive app states shouldn't cross-dissolve (GB-1017).
    const riskJob = withPopIn(mkJob(await grabTree(page), { title: APP_TITLE, kind: 'browser', caption: 'AI scores every file’s risk' },
      { duration: 2000, transition: { type: 'cut', duration: 0 } }), 'popInRisk',
      launchJobs[launchJobs.length - 1].fullSvg ?? '');
    clickSpecs.push({ job: riskJob, offset: 1400, hit: browseHit });

    // === 2. Browse a file, then open the target diff ======================
    await openFile(page, BROWSE_FILE);
    await page.waitForTimeout(500);
    const targetHit = await sidebarHit(page, TARGET_FILE);
    await debugShot(page, 'browse');
    // Cut (not crossfade) to the diff — same window, next state (GB-1018).
    const browseJob = mkJob(await grabTree(page), { title: APP_TITLE, kind: 'browser', caption: 'Browse the changes' },
      { duration: 1500, transition: { type: 'cut', duration: 0 } });
    clickSpecs.push({ job: browseJob, offset: 1000, hit: targetHit });

    await openFile(page, TARGET_FILE);
    await page.waitForSelector('.ai-note-guided', { timeout: 10000 });
    const lineSel = `.diff-line.split-right[data-side="new"][data-line="${String(TARGET_LINE)}"]`;
    await page.waitForSelector(lineSel, { timeout: 15000 });
    await page.locator(lineSel).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const lineBox = await page.locator(lineSel).boundingBox();
    if (lineBox === null) throw new Error('target line not visible');
    await debugShot(page, 'diff');
    // Cut (not crossfade) to the annotation form — same window, next state (GB-1019).
    const diffJob = mkJob(await grabTree(page), { title: APP_TITLE, kind: 'browser', caption: 'Review with AI “Learn” notes' },
      { duration: 2600, transition: { type: 'cut', duration: 0 } });
    clickSpecs.push({ job: diffJob, offset: 1800, hit: center(lineBox) });

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
    const typingOverlay: TypingOverlay = {
      kind: 'typing', text: FEEDBACK,
      x: field.x + OX, y: field.y + OY + field.fontSize * 0.9,
      fontSize: field.fontSize, color: field.color, speed: TYPING_SPEED,
      delay: baseDelay, bgColor: field.bg, bgWidth: field.w, bgHeight: field.fontSize * 1.5,
      caret: true,
    };

    await debugShot(page, 'form');
    // Cut (not crossfade) from the annotation form to the saved state. Under
    // domotion's exit-semantics (DM-1414) it's THIS frame's transition — not the
    // next frame's — that governs the form→saved handoff; a crossfade here faded
    // the typed-feedback overlay out, which read as the text vanishing on save
    // (GB-1020 "input text disappears" / GB-1021 "weird fade out"). A cut resolves
    // the typed note straight into the saved annotation.
    const formJob = mkJob(await grabTree(page), { title: APP_TITLE, kind: 'browser', caption: 'Leave a note for your AI' },
      { duration: typeEnd + 1100, transition: { type: 'cut', duration: 0 }, overlays: [typingOverlay] });
    clickSpecs.push({ job: formJob, offset: typeEnd + 550, hit: center(saveBox) });

    // === 4. Save + complete ===============================================
    await page.fill('.annotation-form-container textarea', FEEDBACK);
    await page.click('.annotation-form-container .annotation-save-btn');
    await page.waitForSelector('.annotation-item', { timeout: 5000 });
    await page.waitForTimeout(400);
    const completeBox = await page.locator('#complete-review').boundingBox();
    if (completeBox === null) throw new Error('complete-review button not found');
    await debugShot(page, 'saved');
    // This frame's transition is its exit to the completion modal (exit-semantics,
    // DM-1414): a cut — the modal is a distinct overlay, not a cross-dissolve of
    // the same window.
    const savedJob = mkJob(await grabTree(page), { title: APP_TITLE, kind: 'browser', caption: 'A bug to fix — and a rule to remember' },
      { duration: 1700, transition: { type: 'cut', duration: 0 } });
    clickSpecs.push({ job: savedJob, offset: 1150, hit: center(completeBox) });

    await page.click('#complete-review');
    await page.waitForSelector('.modal-copyable', { timeout: 8000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const first = document.querySelector('.modal-copyable');
      if (first) first.textContent = '.glassbox/latest-review.md';
    });
    await debugShot(page, 'modal');
    // Cut (not push-left) to the markdown peek. A push-left slides the modal out
    // but domotion does NOT slide the incoming frame in with it — it cuts in after
    // the outgoing has left, so the transparent canvas flashes through in between.
    // (This is the same limitation the markdown→terminal transition hit; slide-in
    // simply doesn't engage in this pipeline.) A cut is clean and gap-free.
    const modalJob = mkJob(await grabTree(page), { title: APP_TITLE, kind: 'browser', caption: 'Finish — feedback is exported' },
      { duration: 2300, transition: { type: 'cut', duration: 0 } });
    // Click the modal's "Done" button (cursor pulse) before this frame
    // transitions away — it reads as the reviewer dismissing the dialog rather
    // than an unmotivated cut to the next scene (GB-1006).
    const doneBtn = page.locator('[data-action="modal-done"]');
    const doneBox = (await doneBtn.count() > 0) ? await doneBtn.first().boundingBox() : null;
    if (doneBox !== null) clickSpecs.push({ job: modalJob, offset: 1700, hit: center(doneBox) });

    // Read the freshly-exported markdown for the peek frame.
    try { markdown = readFileSync(EXPORT_MD, 'utf-8'); }
    catch { markdown = '# Code Review\n\n## File Annotations\n\n### src/auth/session.ts\n\n- **Line 23** [bug]: ' + FEEDBACK; }

    // === loop-close frame (fix applied + annotation resolved) =============
    if (doneBox !== null) await doneBtn.first().click();
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
    // The fixed-diff window. It's a layered pop-in over the Claude terminal
    // (GB-1024) — applied AFTER the Claude cast is rendered below, since it needs
    // that beat's last frame as its fading background. Its own transition is the
    // exit to the end card (the loop seam), a crossfade.
    const loopJob = mkJob(await grabTree(page),
      { title: APP_TITLE, kind: 'browser', caption: 'The loop closes — issue resolved' },
      { duration: 2200, transition: { type: 'crossfade', duration: 360 } });

    // === 5. Markdown peek (separate page) =================================
    const aux = await ctx.newPage();
    await aux.setViewportSize({ width: CONTENT_W, height: CONTENT_H });
    await aux.setContent(markdownPeekHtml({ width: CONTENT_W, height: CONTENT_H, markdown }));
    await aux.waitForTimeout(150);
    await debugShot(aux, 'markdown');
    const markdownJob: FrameJob = {
      tree: await grabTree(aux), prefix: nextPrefix(),
      chrome: { title: '.glassbox/latest-review.md', kind: 'browser', caption: 'Exported as structured markdown your AI reads' },
      // This transition is markdown's exit to the Claude terminal (exit-semantics,
      // DM-1414). A `cut`, not a slide: a push-left here slides the markdown out but
      // domotion does NOT slide the incoming terminal CAST frame in with it, leaving
      // a transparent gap where the page shows through. A cut is clean and symmetric
      // (both hard), and removes the old lopsided review-slides-but-terminal-fades
      // asymmetry (GB-1022) without introducing the gap.
      meta: { duration: 2600, transition: { type: 'cut', duration: 0 } },
    };

    // === 6. Terminal scenes (domotion term) ==============================
    // The Claude Code `/glassbox` session as a real terminal recording: the user
    // runs `/glassbox`, Claude reads the review, applies the URL-encoding fix (the
    // same change the loop-closing frame shows), and tests pass. Rendered now
    // (needs the browser). It's entered from the markdown peek via a clean cut
    // (owned by `markdownJob`'s exit transition, exit-semantics DM-1414) — symmetric
    // and fade-free, replacing the old review-slides-but-terminal-fades asymmetry
    // (GB-1022). A true push-left of the terminal isn't feasible — domotion won't
    // slide an incoming CAST frame in, so it left a transparent gap. The cast frames
    // cut internally too — no "weird fade out" mid-terminal (GB-1023).
    const claudeJobs = await renderTermCast(claudeCast(TERM_COLS, 30), 30, {
      title: TERM_TITLE, caption: 'Hand the review to Claude Code — it applies the fix',
    });
    // Now that the Claude beat exists, make the loop frame a layered pop-in over
    // its last frame — the terminal stays behind and fades out while the fixed
    // diff pops in on top (GB-1024).
    withPopIn(loopJob, 'popInLoop', claudeJobs[claudeJobs.length - 1].fullSvg ?? '');

    // Assemble the final frame order: launch terminal → app review beats →
    // markdown peek → Claude terminal → loop-close. Index bookkeeping is by job
    // reference (below), so the variable terminal frame counts don't matter.
    const jobs: FrameJob[] = [
      ...launchJobs,
      riskJob, browseJob, diffJob, formJob, savedJob, modalJob,
      markdownJob,
      ...claudeJobs,
      loopJob,
    ];
    const endJobIndex = jobs.length; // end card appended after the mapped frames

    // === Teardown, then render ============================================
    // Close the context first so the recorded HAR is flushed to disk
    // (`browser.close()` alone doesn't reliably write it out).
    await ctx.close();
    await browser.close();
    browser = null;
    server.kill('SIGTERM');

    // Render the app frames (the terminal cast frames were already rendered to
    // SVG during the session — they carry `fullSvg`). The text mode + embedded
    // font builder were set up once after the browser launched and are NOT
    // cleared here, so app glyphs accumulate alongside the terminal glyphs.
    const frames: AnimationFrame[] = jobs.map(j => {
      if (j.fullSvg !== undefined) return { ...j.meta, svgContent: j.fullSvg };
      const tree = j.tree as CapturedTree;
      // Drop elements outside the content viewport (diff lines below the fold,
      // scrolled-off sidebar rows) — the window chrome clips them anyway, but
      // they'd still emit glyphs into the embedded font. Static frames don't
      // scroll, so we mutate the tree and discard the returned cull keyframes.
      cullElementsOutsideViewBox(tree, CONTENT_W, CONTENT_H, undefined, 0, 1);
      // includeGlyphDefs=false → per-frame font CSS is also suppressed; the
      // embedded-font @font-face is collected once below for the whole SVG.
      let svgContent = chromeWrap(elementTreeToSvgInner(tree, CONTENT_W, CONTENT_H, j.prefix, false), {
        title: j.chrome?.title ?? '', kind: j.chrome?.kind ?? 'browser', id: j.prefix, caption: j.chrome?.caption,
      });
      // Layered pop-in: the terminal background (fading) UNDER the app window
      // (scale-popping on top) — see `popInFrameSvg` (GB-1016 / GB-1024).
      if (j.popInId !== undefined) {
        svgContent = popInFrameSvg(j.popInBgSvg ?? '', svgContent,
          { scaleId: j.popInId, fadeId: j.popInFadeId ?? `${j.popInId}Fade` });
      }
      return { ...j.meta, svgContent };
    });
    // End card: hand-built SVG floating in the same window rect, no glyph capture.
    frames.push({
      svgContent: endCardSvg(),
      duration: 2400, transition: { type: 'crossfade', duration: 380 },
    });
    const fontFaceCss = getEmbeddedFontFaceCss(); // base64 font subset, hoisted once

    // === Cursor track =====================================================
    const frameStart: number[] = [];
    { let acc = 0; for (const f of frames) { frameStart.push(acc); acc += f.duration + transitionMs(f); } }
    const idxOf = (job: FrameJob): number => jobs.indexOf(job);
    const MOVE_MS = 420;
    const DWELL = 160;
    // Hidden through the CLI-launch terminal beat; appears when the live app does.
    const cursorEvents: CursorEvent[] = [
      { type: 'hide', t: 0 },
      { type: 'show', t: frameStart[idxOf(riskJob)], x: OX + CONTENT_W * 0.18, y: OY + CONTENT_H * 0.3 },
    ];
    for (const c of clickSpecs) {
      const clickT = frameStart[idxOf(c.job)] + c.offset;
      const hit = shift(c.hit);
      cursorEvents.push({ type: 'move', t: Math.max(0, clickT - DWELL - MOVE_MS), duration: MOVE_MS, to: { x: hit.cx, y: hit.cy } });
      cursorEvents.push({ type: 'click', t: clickT });
    }
    // Hide for the markdown/terminal/end-card scenes; reappear on the loop frame.
    cursorEvents.push({ type: 'hide', t: frameStart[idxOf(markdownJob)] });
    cursorEvents.push({ type: 'show', t: frameStart[idxOf(loopJob)], x: OX + CONTENT_W * 0.5, y: OY + CONTENT_H * 0.5 });
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
