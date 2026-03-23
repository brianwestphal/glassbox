import { showAnnotationForm } from '../annotations/form.js';

const DRAG_THRESHOLD = 5; // pixels — movement beyond this is a text selection, not a click

export function bindDiffLineClicks() {
  document.querySelectorAll('.diff-line').forEach(el => {
    let startX = 0;
    let startY = 0;

    el.addEventListener('mousedown', (e) => {
      startX = (e as MouseEvent).clientX;
      startY = (e as MouseEvent).clientY;
    });

    el.addEventListener('click', (e) => {
      // Ignore Cmd/Ctrl+Click (go-to-definition)
      if ((e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) return;
      // Ignore clicks on annotation UI elements
      if ((e.target as HTMLElement).closest('.annotation-form-container') || (e.target as HTMLElement).closest('.annotation-row')) return;

      // Ignore if the user dragged (text selection)
      const dx = Math.abs((e as MouseEvent).clientX - startX);
      const dy = Math.abs((e as MouseEvent).clientY - startY);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) return;

      const htmlEl = el as HTMLElement;
      let line = parseInt(htmlEl.dataset.line ?? '0', 10);
      let side = htmlEl.dataset.side ?? 'new';

      // For old-side clicks, prefer the new-side line number so annotations reference the new file
      if (side === 'old' && htmlEl.dataset.newLine !== undefined && htmlEl.dataset.newLine !== '') {
        const newLine = parseInt(htmlEl.dataset.newLine, 10);
        if (!isNaN(newLine)) {
          line = newLine;
          side = 'new';
        }
      }

      if (!isNaN(line)) showAnnotationForm(htmlEl, line, side);
    });
  });
}
