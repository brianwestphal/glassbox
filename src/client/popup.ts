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

/** Fixed-position `el` directly below `anchor`, left-aligned (the shared
 *  popup placement). Layering comes from the element's SCSS class — don't set
 *  inline z-index. */
export function positionBelowAnchor(el: HTMLElement, anchor: HTMLElement, gapPx = 4): void {
  const rect = anchor.getBoundingClientRect();
  el.style.position = 'fixed';
  el.style.left = `${String(rect.left)}px`;
  el.style.top = `${String(rect.bottom + gapPx)}px`;
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
