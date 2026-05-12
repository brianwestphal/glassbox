import { diffViewStore } from '../stores/index.js';

export function initScrollSync() {
  const container = document.getElementById('diff-container');
  if (!container) return;

  let lastScrollLeft = 0;
  let rafId: number | null = null;
  let syncing = false;

  container.addEventListener('scroll', (e) => {
    const dv = diffViewStore.state.value;
    if (syncing || dv.wrapLines || dv.diffMode !== 'split') return;
    const target = e.target as HTMLElement;
    if (!target.classList.contains('code')) return;
    if (!target.closest('.split-row') && !target.closest('.split-columns')) return;

    const scrollLeft = target.scrollLeft;
    if (scrollLeft === lastScrollLeft) return;
    lastScrollLeft = scrollLeft;

    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      syncing = true;
      container.querySelectorAll('.split-row .code, .split-columns .code').forEach(el => {
        if (el !== target && (el as HTMLElement).scrollLeft !== scrollLeft) {
          (el as HTMLElement).scrollLeft = scrollLeft;
        }
      });
      syncing = false;
    });
  }, true);
}
