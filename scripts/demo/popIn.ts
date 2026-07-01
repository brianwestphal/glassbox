/**
 * Layered "pop-in" for the demo hero (GB-1016 / GB-1024).
 *
 * When the live-app window first appears (over the launch terminal) and when the
 * fixed-diff window reappears (over the Claude terminal), the maintainer wants a
 * LAYERED reveal rather than an A→B crossfade (a crossfade fades both layers, so
 * mid-transition you see *through* the app to the terminal):
 *
 *   1. keep A (the terminal) visible
 *   2. pop B (the app window) in ON TOP as a new layer — the app frame is entered
 *      via a `cut`, so it's opaque and z-ordered above A from t=0, then scales in
 *   3. fade A → nothing BEHIND B (a slightly-delayed opacity fade) so the terminal
 *      dissolves out behind the app that's already sitting on top of it
 *
 * domotion has no single "cover-fade" transition that does this, so it's composed
 * from a `cut` entry (owned by the previous terminal frame's transition, under the
 * DM-1414 exit-semantics: a frame's entrance is driven by the PREVIOUS frame's
 * transition) plus two intra-frame animations on this frame — one on the app
 * layer, one on the terminal-background layer. Pure + exported so the layering
 * contract (app on top, terminal fades behind, fade is delayed) is unit-tested.
 */

import type { AnimationFrame } from 'domotion-svg';

type IntraFrameAnimation = NonNullable<AnimationFrame['animations']>[number];

export interface PopInIds {
  /** anim id for the app layer's scale-pop. */
  scaleId: string;
  /** anim id for the terminal-background layer's fade-out. */
  fadeId: string;
}

export function popInIds(base: string): PopInIds {
  return { scaleId: base, fadeId: `${base}Fade` };
}

/**
 * The two intra-frame animations for a layered pop-in: the app window scales in
 * on top (it's already opaque from the `cut` entry) while the prior terminal
 * frame fades out BEHIND it. The fade is `delay`ed so the app lands first — the
 * terminal dissolves out from under an app that's already sitting on top of it,
 * not a simultaneous mutual crossfade.
 */
export function popInAnimations(ids: PopInIds): IntraFrameAnimation[] {
  return [
    {
      animId: ids.scaleId, property: 'scale', from: '0.9', to: '1',
      duration: 440, transformOrigin: 'center', easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    },
    {
      animId: ids.fadeId, property: 'opacity', from: '1', to: '0',
      duration: 340, delay: 200, easing: 'ease-in',
    },
  ];
}

/**
 * Compose the pop-in frame content: the terminal background (in its fade group)
 * FIRST, then the app window (in its scale group) — document order is z-order, so
 * the app must come last to sit on top of the fading terminal.
 */
export function popInFrameSvg(bgTerminalSvg: string, appSvg: string, ids: PopInIds): string {
  return (
    `<g class="anim-${ids.fadeId}">${bgTerminalSvg}</g>` +
    `<g class="anim-${ids.scaleId}">${appSvg}</g>`
  );
}
