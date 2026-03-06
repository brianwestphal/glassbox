import { showAnnotationForm } from '../annotations/form.js';

export function bindDiffLineClicks() {
  document.querySelectorAll('.diff-line').forEach(el => {
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.annotation-form-container') || (e.target as HTMLElement).closest('.annotation-row')) return;
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
