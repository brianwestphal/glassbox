import { state } from '../state.js';
import { api } from '../api.js';
import { selectFile } from './selection.js';

export function bindDragDrop() {
  document.querySelectorAll('.diff-line').forEach(el => {
    el.addEventListener('dragover', (e) => {
      if (!state._dragAnnotation) return;
      e.preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = 'move';
      document.querySelectorAll('.diff-line.drag-over').forEach(d => d.classList.remove('drag-over'));
      el.classList.add('drag-over');
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });

    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      document.querySelectorAll('.diff-line.drag-over').forEach(d => d.classList.remove('drag-over'));
      if (!state._dragAnnotation) return;

      const lineNum = parseInt((el as HTMLElement).dataset.line!, 10);
      const side = (el as HTMLElement).dataset.side || 'new';
      if (isNaN(lineNum)) return;

      const drag = state._dragAnnotation;
      state._dragAnnotation = null;

      await api('/annotations/' + drag.id + '/move', {
        method: 'PATCH',
        body: { lineNumber: lineNum, side: side },
      });

      if (state.currentFileId) selectFile(state.currentFileId);
    });
  });
}
