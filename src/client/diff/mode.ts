import { state } from '../state.js';
import { selectFile } from './selection.js';

export function bindDiffModeToggle() {
  document.querySelectorAll('[data-diff-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.diffMode = (btn as HTMLElement).dataset.diffMode as 'split' | 'unified';
      document.querySelectorAll('[data-diff-mode]').forEach(b => b.classList.toggle('active', b === btn));
      if (state.currentFileId) selectFile(state.currentFileId);
    });
  });
}

export function bindWrapToggle() {
  const btn = document.getElementById('wrap-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.wrapLines = !state.wrapLines;
    btn.classList.toggle('active', state.wrapLines);
    const container = document.getElementById('diff-container');
    if (container) {
      container.classList.toggle('wrap-lines', state.wrapLines);
    }
    if (!state.wrapLines) {
      resetScrollSync();
    }
  });
}

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

function resetScrollSync() {
  const container = document.getElementById('diff-container');
  if (!container) return;
  container.querySelectorAll('.split-row .code').forEach(el => {
    (el as HTMLElement).scrollLeft = 0;
  });
}
