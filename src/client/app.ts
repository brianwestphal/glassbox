import { state } from './state.js';
import { loadFiles } from './sidebar/fileTree.js';
import { bindSidebarEvents, bindFileFilter, bindSidebarResize } from './sidebar/controls.js';
import { initScrollSync } from './diff/mode.js';
import { bindToolbar } from './diff/toolbar.js';
import { bindCompleteButton, bindReopenButton } from './review/modal.js';
import { updateProgress } from './review/progress.js';

async function init() {
  await loadFiles();
  bindSidebarEvents();
  bindToolbar();
  bindFileFilter();
  bindSidebarResize();
  bindCompleteButton();
  bindReopenButton();
  initScrollSync();
  updateProgress();
  document.addEventListener('dragend', () => {
    state._dragAnnotation = null;
    document.querySelectorAll('.diff-line.drag-over').forEach(d => d.classList.remove('drag-over'));
  });
}

init();
