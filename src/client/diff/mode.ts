import { state } from '../state.js';

export function initScrollSync() {
  const container = document.getElementById('diff-container');
  if (!container) return;

  let lastScrollLeft = 0;
  let rafId: number | null = null;
  let syncing = false;

  container.addEventListener('scroll', (e) => {
    if (syncing || state.wrapLines || state.diffMode !== 'split') return;
    const target = e.target as HTMLElement;
    if (!target.classList || !target.classList.contains('code')) return;
    if (!target.closest('.split-row')) return;

    const scrollLeft = target.scrollLeft;
    if (scrollLeft === lastScrollLeft) return;
    lastScrollLeft = scrollLeft;

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      syncing = true;
      container.querySelectorAll('.split-row .code').forEach(el => {
        if (el !== target && (el as HTMLElement).scrollLeft !== scrollLeft) {
          (el as HTMLElement).scrollLeft = scrollLeft;
        }
      });
      syncing = false;
    });
  }, true);
}
