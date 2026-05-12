import { selectFile } from '../diff/selection.js';
import { reviewStore } from '../stores/index.js';
import { renderFileList } from './fileTree.js';

export function bindFileFilter() {
  const input = document.getElementById('file-filter') as HTMLInputElement | null;
  if (input === null) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  input.addEventListener('input', () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      reviewStore.actions.update({ filterText: input.value });
      renderFileList();
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      reviewStore.actions.update({ filterText: '' });
      renderFileList();
      input.blur();
    }
  });
}

export function bindSidebarResize() {
  const handle = document.getElementById('sidebar-resize');
  const sidebar = document.querySelector<HTMLElement>('.sidebar');
  if (handle === null || sidebar === null) return;

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

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
    sidebar.style.width = String(newWidth) + 'px';
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
  const { fileOrder, currentFileId } = reviewStore.state.value;
  const idx = currentFileId !== null ? fileOrder.indexOf(currentFileId) : -1;
  const order = fileOrder;
  const next = idx + delta;
  if (next >= 0 && next < order.length) {
    void selectFile(order[next]);
  }
}
