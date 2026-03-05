import { state } from '../state.js';
import { api } from '../api.js';
import { renderFileList } from '../sidebar/fileTree.js';
import { updateProgress } from '../review/progress.js';
import { bindDiffLineClicks } from './lineClicks.js';
import { bindHunkExpanders } from './hunkExpander.js';
import { bindDragDrop } from './dragDrop.js';
import { bindServerAnnotations } from '../annotations/events.js';

export async function selectFile(fileId: string) {
  state.currentFileId = fileId;
  document.querySelectorAll('.file-item').forEach(el => {
    (el as HTMLElement).classList.toggle('active', (el as HTMLElement).dataset.fileId === fileId);
  });

  const container = document.getElementById('diff-container')!;
  const welcome = document.querySelector('.welcome-message') as HTMLElement | null;
  if (welcome) welcome.style.display = 'none';
  container.style.display = 'block';

  const res = await fetch('/file/' + fileId + '?mode=' + state.diffMode);
  container.innerHTML = await res.text();

  container.classList.toggle('wrap-lines', state.wrapLines);

  const file = state.files.find(f => f.id === fileId);
  if (file && file.status === 'pending') {
    await api('/files/' + fileId + '/status', { method: 'PATCH', body: { status: 'reviewed' } });
    file.status = 'reviewed';
    renderFileList();
    updateProgress();
  }

  bindDiffLineClicks();
  bindHunkExpanders();
  bindDragDrop();
  bindServerAnnotations();
}
