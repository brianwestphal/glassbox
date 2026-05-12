import { api } from '../api.js';
import { dragStore, reviewStore } from '../stores/index.js';
import { selectFile } from './selection.js';

export function bindDragDrop() {
  document.querySelectorAll('.diff-line').forEach(el => {
    el.addEventListener('dragover', (e) => {
      if (dragStore.state.value.annotation === null) return;
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
      const drag = dragStore.state.value.annotation;
      if (drag === null) return;

      const htmlEl = el as HTMLElement;
      let lineNum = parseInt(htmlEl.dataset.line ?? '0', 10);
      let side = htmlEl.dataset.side ?? 'new';
      if (isNaN(lineNum)) return;

      // For old-side drops, prefer the new-side line number
      if (side === 'old' && htmlEl.dataset.newLine !== undefined && htmlEl.dataset.newLine !== '') {
        const newLine = parseInt(htmlEl.dataset.newLine, 10);
        if (!isNaN(newLine)) {
          lineNum = newLine;
          side = 'new';
        }
      }

      dragStore.actions.setAnnotation(null);

      void (async () => {
        await api('/annotations/' + drag.id + '/move', {
          method: 'PATCH',
          body: { lineNumber: lineNum, side: side },
        });

        const currentFileId = reviewStore.state.value.currentFileId;
        if (currentFileId !== null) {
          void selectFile(currentFileId);
        }
      })();
    });
  });
}
