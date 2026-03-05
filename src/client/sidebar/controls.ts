import { state } from '../state.js';
import { renderFileList } from './fileTree.js';
import { selectFile } from '../diff/selection.js';

export function bindFileFilter() {
  const input = document.getElementById('file-filter') as HTMLInputElement | null;
  if (!input) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      state.filterText = input.value;
      renderFileList();
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      state.filterText = '';
      renderFileList();
      input.blur();
    }
  });
}

export function bindSidebarResize() {
  const handle = document.getElementById('sidebar-resize');
  const sidebar = document.querySelector('.sidebar') as HTMLElement | null;
  if (!handle || !sidebar) return;

  let dragging = false;
  let startX: number, startWidth: number;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    let newWidth = startWidth + (e.clientX - startX);
    newWidth = Math.max(200, Math.min(newWidth, window.innerWidth * 0.6));
    sidebar.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

export function bindSidebarEvents() {
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'j' || e.key === 'ArrowDown') {
      navigateFile(1);
      e.preventDefault();
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      navigateFile(-1);
      e.preventDefault();
    }
  });
}

function navigateFile(delta: number) {
  const order = state.fileOrder;
  const idx = order.indexOf(state.currentFileId!);
  const next = idx + delta;
  if (next >= 0 && next < order.length) {
    selectFile(order[next]);
  }
}
