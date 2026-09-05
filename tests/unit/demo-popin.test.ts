/**
 * Guards for the demo hero's transition/layering contract (GB-1016…GB-1024).
 *
 * Two classes of regression these pin:
 *
 *  1. The layered pop-in (`scripts/demo/popIn.ts`): the app window must sit ON TOP
 *     of the fading terminal, and the terminal's fade must be DELAYED so the app
 *     lands first — the "keep A, pop B on top, fade A behind" reveal, not a mutual
 *     crossfade. Pure functions, asserted directly.
 *
 *  2. The exit-semantics off-by-one: domotion 0.16+ (DM-1414) made a frame's
 *     `transition` its EXIT, with a frame's entrance driven by the PREVIOUS frame.
 *     The storyboard was written against the old "transition = entry" model, which
 *     put the "don't fade" cut on the wrong beat (the typed-note fade, GB-1020/21)
 *     and crossfaded consecutive app states (GB-1017/18/19). Source-level checks
 *     keep the storyboard on the corrected model.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { popInAnimations, popInFrameSvg, popInIds } from '../../scripts/demo/popIn.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE_SRC = readFileSync(join(HERE, '../../scripts/demo/capture-demo.ts'), 'utf-8');

describe('demo pop-in layering (popIn.ts)', () => {
  it('derives a distinct fade id from the base', () => {
    const ids = popInIds('popInRisk');
    expect(ids.scaleId).toBe('popInRisk');
    expect(ids.fadeId).toBe('popInRiskFade');
    expect(ids.fadeId).not.toBe(ids.scaleId);
  });

  it('layers the app window ON TOP of the terminal background', () => {
    const ids = popInIds('popInLoop');
    const svg = popInFrameSvg('<!--TERMINAL-->', '<!--APP-->', ids);
    // Document order is z-order: the terminal (fade group) must come first, the
    // app (scale group) last so it sits on top.
    const termIdx = svg.indexOf('<!--TERMINAL-->');
    const appIdx = svg.indexOf('<!--APP-->');
    expect(termIdx).toBeGreaterThanOrEqual(0);
    expect(appIdx).toBeGreaterThan(termIdx);
    // The terminal is wrapped in the fade group (first), the app in the scale
    // group (second, on top). Match the full quoted class so scaleId doesn't
    // substring-collide with fadeId (`anim-popInLoop` ⊂ `anim-popInLoopFade`).
    const fadeWrap = `<g class="anim-${ids.fadeId}">`;
    const scaleWrap = `<g class="anim-${ids.scaleId}">`;
    expect(svg.indexOf(fadeWrap)).toBeGreaterThanOrEqual(0);
    expect(svg.indexOf(scaleWrap)).toBeGreaterThan(svg.indexOf(fadeWrap));
    expect(svg.indexOf(fadeWrap)).toBeLessThan(termIdx);
    expect(svg.indexOf(scaleWrap)).toBeLessThan(appIdx);
  });

  it('pops the app in and fades the terminal out BEHIND it (delayed)', () => {
    const ids = popInIds('popInRisk');
    const anims = popInAnimations(ids);
    const scale = anims.find(a => a.animId === ids.scaleId);
    const fade = anims.find(a => a.animId === ids.fadeId);

    // App layer: a center-origin scale-pop toward full size.
    expect(scale).toBeDefined();
    expect(scale!.property).toBe('scale');
    expect(Number(scale!.to)).toBe(1);
    expect(Number(scale!.from)).toBeLessThan(1);
    expect(scale!.transformOrigin).toBe('center');

    // Terminal layer: fades fully out, and starts AFTER the app has begun landing
    // (delay > 0) — this delay is the whole point (app on top first, then A→nothing
    // behind it), so pin it explicitly.
    expect(fade).toBeDefined();
    expect(fade!.property).toBe('opacity');
    expect(Number(fade!.from)).toBe(1);
    expect(Number(fade!.to)).toBe(0);
    expect(fade!.delay ?? 0).toBeGreaterThan(0);
  });
});

describe('demo storyboard transition contract (capture-demo.ts, exit-semantics)', () => {
  it('does not reintroduce an entry-transition crossfade on the terminal casts', () => {
    // The old model set the first cast frame's transition to an `entry` crossfade;
    // under exit-semantics that only crossfaded frame-0→frame-1 INSIDE the terminal
    // (a "weird fade out", GB-1023). renderTermCast must not carry an `entry` again.
    expect(CAPTURE_SRC).not.toMatch(/\bentry\s*:/);
  });

  it('cuts (not crossfades) between consecutive app beats', () => {
    // GB-1017/18/19/20/21: risk→browse→diff→form→saved are the same window changing
    // state — they must cut, never cross-dissolve. There should be no `crossfade`
    // among the app-review frame metas. The only crossfade left is the loop→end-card
    // seam (loopJob) and the end card itself.
    const crossfades = CAPTURE_SRC.match(/type:\s*'crossfade'/g) ?? [];
    // loopJob's exit + the end-card push are the sole legitimate crossfades.
    expect(crossfades.length).toBeLessThanOrEqual(2);
  });

  it('measures the browse cursor target only after risk analysis has settled', () => {
    // The risk-sorted sidebar keeps reordering (and the "Analyzing…" banner
    // shifts rows) while scores stream in. Measuring `browseHit` mid-stream left
    // the cursor pointing at the wrong row once the frame was composited — it
    // appeared to click `auth.ts` while the click actually opened `redis.ts`
    // (GB-1188). The capture must wait for a stable list (no
    // `.analysis-loading-inline`) BEFORE it measures `browseHit`.
    const settleIdx = CAPTURE_SRC.indexOf("'.analysis-loading-inline', { state: 'detached'");
    const browseHitIdx = CAPTURE_SRC.indexOf('const browseHit =');
    expect(settleIdx).toBeGreaterThanOrEqual(0);
    expect(browseHitIdx).toBeGreaterThan(settleIdx);
  });

  it('layers the pop-in over the previous terminal beat (both pop-ins carry a bg)', () => {
    // Each `withPopIn(...)` call must pass a terminal background SVG (its 3rd arg)
    // so the app pops in OVER a fading terminal, not onto nothing.
    // Call sites only — exclude the `function withPopIn(job…)` definition.
    const calls = CAPTURE_SRC.match(/withPopIn\((?!job\b)/g) ?? [];
    expect(calls.length).toBe(2); // risk + loop
    expect(CAPTURE_SRC).toContain("launchJobs[launchJobs.length - 1].fullSvg");
    expect(CAPTURE_SRC).toContain("claudeJobs[claudeJobs.length - 1].fullSvg");
  });
});
