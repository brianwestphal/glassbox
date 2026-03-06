import { api } from '../api.js';
import { state } from '../state.js';
import { selectFile } from './selection.js';

export function bindDragDrop() {
  document.querySelectorAll('.diff-line').forEach(el => {
    el.addEventListener('dragover', (e) => {
      if (state._dragAnnotation === null) return;
      e.preventDefault();
      const dragEvent = e as DragEvent;
      if (dragEvent.dataTransfer !== null) {
        dragEvent.dataTransfer.dropEffect = 'move';
      }
      document.querySelectorAll('.diff-line.drag-over').forEach(d => { d.classList.remove('drag-over'); });
      el.classList.add('drag-over');
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      document.querySelectorAll('.diff-line.drag-over').forEach(d => { d.classList.remove('drag-over'); });
      if (state._dragAnnotation === null) return;

      const lineNum = parseInt((el as HTMLElement).dataset.line ?? '0', 10);
      const side = (el as HTMLElement).dataset.side ?? 'new';
      if (isNaN(lineNum)) return;

      const drag = state._dragAnnotation;
      state._dragAnnotation = null;

      void (async () => {
        await api('/annotations/' + drag.id + '/move', {
          method: 'PATCH',
          body: { lineNumber: lineNum, side: side },
        });

        if (state.currentFileId !== null) {
          void selectFile(state.currentFileId);
        }
      })();
    });
  });
}
