import { delegate, effect, mount } from 'kerfjs';

import { RiskDimensionSchema, saveAIPreferences } from '../../api/index.js';
import { selectFile } from '../diff/selection.js';
import { asEl, asElement, asInput, asSelect, toElement } from '../dom.js';
import type { SortMode } from '../state.js';
import { aiStore, diffViewStore, reviewStore, visibleFileOrder } from '../stores/index.js';
import { FILTER_DEBOUNCE_MS } from '../timing.js';
import { ACTIONS } from './actions.js';
import { bindFileContextMenu } from './contextMenu.js';
import { fileListJsx } from './fileListView.js';
import { showRiskPopover } from './riskPopover.js';
import { sortControlJsx } from './sortControl.js';
import { switchSortMode } from './sortMode.js';


export function initSidebar(): void {
  const sidebar = document.querySelector<HTMLElement>('.sidebar');
  if (sidebar === null) return;

  restoreCollapsedFolders();
  mountSortControl(sidebar);
  mountFileList(sidebar);
  bindDelegatedEvents(sidebar);
  bindFileContextMenu(sidebar);
  bindSidebarResize();
  bindSidebarToggle();
  bindKeyboardNav();
  bindAutoScroll(sidebar);
}

/** Hide/show the sidebar from the nav-bar toggle (GB-955). Intentionally not
 *  persisted across reloads: the toggle lives in the nav bar (shown once a file
 *  is open), so persisting a collapsed state could otherwise strand the user
 *  with no sidebar and no visible toggle on a fresh load. */
function bindSidebarToggle(): void {
  const btn = document.getElementById('sidebar-toggle-btn');
  const app = document.querySelector<HTMLElement>('.review-app');
  if (btn === null || app === null) return;
  btn.addEventListener('click', () => {
    const collapsed = app.classList.toggle('sidebar-collapsed');
    btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    btn.setAttribute('title', collapsed ? 'Show sidebar' : 'Hide sidebar');
  });
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
  void delegate(sidebar, 'click', '[data-sort-mode]', (_e, btn) => {
    const mode = asEl(btn).dataset.sortMode as SortMode;
    if (mode === aiStore.state.value.sortMode) return;
    if ((mode === 'risk' || mode === 'narrative') && !aiStore.state.value.aiConfigured) {
      void import('../settings/dialog.js').then(m => {
        m.showSettingsDialog(() => { switchSortMode(mode); });
      });
      return;
    }
    switchSortMode(mode);
  });

  void delegate(sidebar, 'click', ACTIONS.toggleRiskScores.selector, () => {
    const next = !aiStore.state.value.showRiskScores;
    aiStore.actions.update({ showRiskScores: next });
    void saveAIPreferences({ show_risk_scores: next });
  });

  void delegate(sidebar, 'change', ACTIONS.setRiskDimension.selector, (_e, sel) => {
    const value = asSelect(sel).value;
    aiStore.actions.update({ riskSortDimension: value });
    const riskDimParsed = RiskDimensionSchema.safeParse(value);
    if (riskDimParsed.success) {
      void saveAIPreferences({ risk_sort_dimension: riskDimParsed.data });
    }
  });

  let filterTimer: ReturnType<typeof setTimeout> | null = null;
  void delegate(sidebar, 'input', '#file-filter', (_e, input) => {
    const value = asInput(input).value;
    if (filterTimer !== null) clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      reviewStore.actions.update({ filterText: value });
    }, FILTER_DEBOUNCE_MS);
  });
  void delegate(sidebar, 'keydown', '#file-filter', (e, input) => {
    if ((e as KeyboardEvent).key === 'Escape') {
      const el = asInput(input);
      el.value = '';
      reviewStore.actions.update({ filterText: '' });
      el.blur();
    }
  });

  void delegate(sidebar, 'click', ACTIONS.selectFile.selector, (_e, el) => {
    const fileId = asEl(el).dataset.fileId;
    if (fileId !== undefined && fileId !== '') void selectFile(fileId);
  });

  void delegate(sidebar, 'click', ACTIONS.toggleFolder.selector, (_e, header) => {
    const path = asEl(header).dataset.folderPath ?? '';
    if (path === '') return;
    if (diffViewStore.state.value.collapsedFolders.has(path)) {
      diffViewStore.actions.removeCollapsedFolder(path);
    } else {
      diffViewStore.actions.addCollapsedFolder(path);
    }
    saveCollapsedFolders();
  });

  void delegate(sidebar, 'click', ACTIONS.showRiskPopover.selector, (e, badge) => {
    e.stopPropagation();
    const fileId = asEl(badge).dataset.fileId ?? '';
    const score = (aiStore.state.value.riskScores ?? []).find(s => s.reviewFileId === fileId);
    if (score !== undefined) showRiskPopover(asEl(badge), score);
  });

  void delegate(sidebar, 'click', ACTIONS.retryAnalysis.selector, (_e, btn) => {
    const mode = asEl(btn).dataset.mode as 'risk' | 'narrative';
    void import('./sortMode.js').then(m => { m.triggerAnalysis(mode); });
  });

  void delegate(sidebar, 'click', ACTIONS.toggleHideIdentical.selector, () => {
    diffViewStore.actions.update({ hideIdentical: !diffViewStore.state.value.hideIdentical });
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

  void delegate(handle, 'mousedown', '*', (e) => {
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
  void delegate(document.body, 'keydown', 'body', (e) => {
    const ke = e as KeyboardEvent;
    const tag = asElement(ke.target).tagName;
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
    if (stored === null) return;
    const parsed: unknown = JSON.parse(stored);
    // Validate the shape rather than trusting it — keep only the strings.
    if (!Array.isArray(parsed)) return;
    const folders = parsed.filter((x): x is string => typeof x === 'string');
    diffViewStore.actions.update({ collapsedFolders: new Set(folders) });
  } catch { /* localStorage unavailable or malformed JSON */ }
}
