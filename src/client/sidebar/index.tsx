import { delegate, effect, mount } from 'kerfjs';

import { api } from '../api.js';
import { selectFile } from '../diff/selection.js';
import { toElement } from '../dom.js';
import type { SortMode } from '../state.js';
import { aiStore, diffViewStore, reviewStore, visibleFileOrder } from '../stores/index.js';
import { ACTIONS } from './actions.js';
import { fileListJsx } from './fileListView.js';
import { showRiskPopover } from './riskPopover.js';
import { sortControlJsx } from './sortControl.js';
import { switchSortMode } from './sortMode.js';

const FILTER_DEBOUNCE_MS = 150;

export function initSidebar(): void {
  const sidebar = document.querySelector<HTMLElement>('.sidebar');
  if (sidebar === null) return;

  restoreCollapsedFolders();
  mountSortControl(sidebar);
  mountFileList(sidebar);
  bindDelegatedEvents(sidebar);
  bindSidebarResize();
  bindKeyboardNav();
  bindAutoScroll(sidebar);
}

function mountSortControl(sidebar: HTMLElement): void {
  const filterEl = sidebar.querySelector('.file-filter');
  if (filterEl === null) return;
  const container = toElement(<div className="sort-mode-container"></div>);
  filterEl.after(container);
  mount(container, () => sortControlJsx());
}

function mountFileList(sidebar: HTMLElement): void {
  const listEl = sidebar.querySelector<HTMLElement>('.file-list-items');
  if (listEl === null) return;
  mount(listEl, () => fileListJsx());
}

function bindDelegatedEvents(sidebar: HTMLElement): void {
  delegate(sidebar, 'click', '[data-sort-mode]', (_e, btn) => {
    const mode = (btn as HTMLElement).dataset.sortMode as SortMode;
    if (mode === aiStore.state.value.sortMode) return;
    if ((mode === 'risk' || mode === 'narrative') && !aiStore.state.value.aiConfigured) {
      void import('../settings/dialog.js').then(m => {
        m.showSettingsDialog(() => { switchSortMode(mode); });
      });
      return;
    }
    switchSortMode(mode);
  });

  delegate(sidebar, 'click', ACTIONS.toggleRiskScores.selector, () => {
    const next = !aiStore.state.value.showRiskScores;
    aiStore.actions.update({ showRiskScores: next });
    void api('/ai/preferences', { method: 'POST', body: { show_risk_scores: next } });
  });

  delegate(sidebar, 'change', ACTIONS.setRiskDimension.selector, (_e, sel) => {
    const value = (sel as HTMLSelectElement).value;
    aiStore.actions.update({ riskSortDimension: value });
    void api('/ai/preferences', { method: 'POST', body: { risk_sort_dimension: value } });
  });

  let filterTimer: ReturnType<typeof setTimeout> | null = null;
  delegate(sidebar, 'input', '#file-filter', (_e, input) => {
    const value = (input as HTMLInputElement).value;
    if (filterTimer !== null) clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      reviewStore.actions.update({ filterText: value });
    }, FILTER_DEBOUNCE_MS);
  });
  delegate(sidebar, 'keydown', '#file-filter', (e, input) => {
    if ((e as KeyboardEvent).key === 'Escape') {
      const el = input as HTMLInputElement;
      el.value = '';
      reviewStore.actions.update({ filterText: '' });
      el.blur();
    }
  });

  delegate(sidebar, 'click', ACTIONS.selectFile.selector, (_e, el) => {
    const fileId = (el as HTMLElement).dataset.fileId;
    if (fileId !== undefined && fileId !== '') void selectFile(fileId);
  });

  delegate(sidebar, 'click', ACTIONS.toggleFolder.selector, (_e, header) => {
    const path = (header as HTMLElement).dataset.folderPath ?? '';
    if (path === '') return;
    if (diffViewStore.state.value.collapsedFolders.has(path)) {
      diffViewStore.actions.removeCollapsedFolder(path);
    } else {
      diffViewStore.actions.addCollapsedFolder(path);
    }
    saveCollapsedFolders();
  });

  delegate(sidebar, 'click', ACTIONS.showRiskPopover.selector, (e, badge) => {
    e.stopPropagation();
    const fileId = (badge as HTMLElement).dataset.fileId ?? '';
    const score = (aiStore.state.value.riskScores ?? []).find(s => s.reviewFileId === fileId);
    if (score !== undefined) showRiskPopover(badge as HTMLElement, score);
  });

  delegate(sidebar, 'click', ACTIONS.retryAnalysis.selector, (_e, btn) => {
    const mode = (btn as HTMLElement).dataset.mode as 'risk' | 'narrative';
    void import('./sortMode.js').then(m => { m.triggerAnalysis(mode); });
  });
}

function bindSidebarResize(): void {
  const handle = document.getElementById('sidebar-resize');
  const sidebar = document.querySelector<HTMLElement>('.sidebar');
  if (handle === null || sidebar === null) return;

  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  let moveListener: ((e: MouseEvent) => void) | null = null;
  let upListener: (() => void) | null = null;

  delegate(handle, 'mousedown', '*', (e) => {
    const me = e as MouseEvent;
    dragging = true;
    startX = me.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    me.preventDefault();

    moveListener = (ev: MouseEvent) => {
      if (!dragging) return;
      let newWidth = startWidth + (ev.clientX - startX);
      newWidth = Math.max(200, Math.min(newWidth, window.innerWidth * 0.6));
      sidebar.style.width = String(newWidth) + 'px';
    };
    upListener = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (moveListener !== null) document.removeEventListener('mousemove', moveListener);
      if (upListener !== null) document.removeEventListener('mouseup', upListener);
      moveListener = null;
      upListener = null;
    };
    document.addEventListener('mousemove', moveListener);
    document.addEventListener('mouseup', upListener);
  });
}

function bindKeyboardNav(): void {
  delegate(document.body, 'keydown', 'body', (e) => {
    const ke = e as KeyboardEvent;
    const tag = (ke.target as HTMLElement).tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (ke.key === 'j' || ke.key === 'ArrowDown') {
      navigateFile(1);
      ke.preventDefault();
    } else if (ke.key === 'k' || ke.key === 'ArrowUp') {
      navigateFile(-1);
      ke.preventDefault();
    }
  });
}

function navigateFile(delta: number): void {
  const order = visibleFileOrder.value;
  const currentFileId = reviewStore.state.value.currentFileId;
  const idx = currentFileId !== null ? order.indexOf(currentFileId) : -1;
  const next = idx + delta;
  if (next >= 0 && next < order.length) {
    void selectFile(order[next]);
  }
}

function bindAutoScroll(sidebar: HTMLElement): void {
  let last: string | null = null;
  effect(() => {
    const fileId = reviewStore.state.value.currentFileId;
    if (fileId === null || fileId === last) return;
    last = fileId;
    requestAnimationFrame(() => {
      const active = sidebar.querySelector<HTMLElement>(`.file-item[data-file-id="${fileId}"]`);
      active?.scrollIntoView({ block: 'nearest' });
    });
  });
}

function storageKey(): string {
  return 'glassbox-collapsed-' + reviewStore.state.value.reviewId;
}

function saveCollapsedFolders(): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...diffViewStore.state.value.collapsedFolders]));
  } catch { /* localStorage unavailable */ }
}

function restoreCollapsedFolders(): void {
  try {
    const stored = localStorage.getItem(storageKey());
    if (stored !== null) {
      diffViewStore.actions.update({ collapsedFolders: new Set(JSON.parse(stored) as string[]) });
    }
  } catch { /* localStorage unavailable */ }
}
