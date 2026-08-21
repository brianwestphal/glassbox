/**
 * Shared helpers for transient, body-appended popups (GB-1087): the category
 * reclassify picker, the sidebar risk popover, the outline dropdown, the
 * toolbar language menu, and the theme-manager menu previously each hand-rolled
 * both of these.
 *
 * The popups are transient document-body overlays that never live inside a
 * kerf `mount()` tree, so a direct `document.addEventListener` is stable here
 * (and removes itself on dismiss). Inside a mount() tree we'd use `delegate()`
 * instead, because re-renders silently drop per-element listeners.
 */

import { autoReposition } from 'kerfjs/overlay';

/** Fixed-position `el` directly below `anchor`, left-aligned (the shared
 *  popup placement), and KEEP it there as the page or any scroll container
 *  scrolls / resizes. Layering comes from the element's SCSS class — don't set
 *  inline z-index.
 *
 *  Delegates to kerfjs/overlay's `autoReposition` (built on `positionAnchored`):
 *  it positions once immediately with the same below-and-left-aligned default —
 *  flipping above the anchor on bottom-viewport overflow and clamping
 *  horizontally into view — then re-runs on capture-phase `scroll` (so a scroll
 *  in any inner container, not just `window`, is caught) and `resize`, so the
 *  popup stays glued to a moving anchor instead of drifting away. It positions
 *  our own element (`position: fixed` + left/top), so the popups' existing SCSS
 *  is untouched; no overlay wrapper is introduced.
 *
 *  Returns a disposer that removes the scroll/resize listeners. Callers MUST
 *  call it when the popup is dismissed (route every close path through it — a
 *  bare `el.remove()` would leak the listeners). Pairing it with
 *  {@link dismissOnOutsideClick}'s `onDismiss` is the intended wiring. */
export function positionBelowAnchor(el: HTMLElement, anchor: HTMLElement, gapPx = 4): () => void {
  return autoReposition(el, anchor, { gap: gapPx });
}

/**
 * Remove `el` (and stop listening) on the first click outside it. The listener
 * attaches on the next tick so the opening click doesn't immediately dismiss;
 * `capture` so a click that a stopPropagation() swallows still dismisses.
 * Returns the dismiss function for callers that close programmatically.
 */
export function dismissOnOutsideClick(
  el: HTMLElement,
  onDismiss?: () => void,
  /** Extra element(s) whose clicks count as "inside" (e.g. the anchor that
   *  toggles the popup, so its own click handler decides instead). */
  alsoInside?: () => (Element | null | undefined)[],
): () => void {
  const close = (e: Event) => {
    const target = e.target as Node;
    if (el.contains(target)) return;
    if (alsoInside?.().some((extra) => extra?.contains(target) === true) === true) return;
    dismiss();
  };
  const dismiss = () => {
    el.remove();
    document.removeEventListener('click', close, true);
    onDismiss?.();
  };
  setTimeout(() => { document.addEventListener('click', close, true); }, 0);
  return dismiss;
}
