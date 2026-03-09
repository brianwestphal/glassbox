import { bindServerAnnotations } from '../annotations/events.js';
import { api } from '../api.js';
import { updateProgress } from '../review/progress.js';
import { renderFileList } from '../sidebar/fileTree.js';
import { state } from '../state.js';
import { renderAINotes } from './aiNotes.js';
import { bindDragDrop } from './dragDrop.js';
import { applyHighlighting,detectLanguage } from './highlight.js';
import { bindHunkExpanders } from './hunkExpander.js';
import { bindDiffLineClicks } from './lineClicks.js';
import { loadOutline } from './outline.js';

export async function selectFile(fileId: string) {
  state.currentFileId = fileId;
  document.querySelectorAll('.file-item').forEach(el => {
    (el as HTMLElement).classList.toggle('active', (el as HTMLElement).dataset.fileId === fileId);
  });

  const container = document.getElementById('diff-container');
  if (container === null) return;
  const welcome = document.querySelector<HTMLElement>('.welcome-message');
  if (welcome !== null) welcome.style.display = 'none';
  container.style.display = 'block';
  const toolbar = document.getElementById('diff-toolbar');
  if (toolbar !== null) toolbar.style.display = '';

  const res = await fetch('/file/' + fileId + '?mode=' + state.diffMode);
  container.innerHTML = await res.text();

  container.classList.toggle('wrap-lines', state.wrapLines);

  const file = state.files.find(f => f.id === fileId);
  if (file !== undefined && file.status === 'pending') {
    await api('/files/' + fileId + '/status', { method: 'PATCH', body: { status: 'reviewed' } });
    file.status = 'reviewed';
    renderFileList();
    updateProgress();
  }

  // Auto-detect language and apply syntax highlighting
  const diffView = container.querySelector<HTMLElement>('.diff-view');
  const filePath = diffView?.dataset.filePath ?? '';
  state._detectedLang = detectLanguage(filePath);
  if (state.highlightAuto) {
    state.highlightLang = state._detectedLang;
  }
  applyHighlighting();
  updateToolbarLanguage();

  void loadOutline(fileId);
  bindDiffLineClicks();
  bindHunkExpanders();
  bindDragDrop();
  bindServerAnnotations();

  // Show AI notes if available for this file
  if (state.sortMode !== 'folder' && fileId in state.fileNotes) {
    renderAINotes(container, fileId);
  }
}

export function updateToolbarLanguage() {
  const btn = document.getElementById('language-btn');
  if (btn === null) return;
  if (state.highlightAuto) {
    const detected = state._detectedLang === 'plaintext' ? 'Plain Text' : state._detectedLang;
    btn.textContent = 'Auto (' + detected + ')';
  } else {
    btn.textContent = state.highlightLang === 'plaintext' ? 'Plain Text' : state.highlightLang;
  }
}
