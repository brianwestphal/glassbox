import { showAnnotationForm } from '../annotations/form.js';

export function bindDiffLineClicks() {
  document.querySelectorAll('.diff-line').forEach(el => {
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.annotation-form-container') || (e.target as HTMLElement).closest('.annotation-row')) return;
      const line = parseInt((el as HTMLElement).dataset.line!, 10);
      const side = (el as HTMLElement).dataset.side || 'new';
      if (!isNaN(line)) showAnnotationForm(el as HTMLElement, line, side);
    });
  });
}
