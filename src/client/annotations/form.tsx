import { raw } from '../../jsx-runtime.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { CATEGORIES } from '../state.js';
import { toElement } from '../dom.js';
import { buildCategoryBadge, bindCategoryBadgeClick } from './categories.js';
import { renderAnnotationInline } from './render.js';
import { renderFileList } from '../sidebar/fileTree.js';

export function showAnnotationForm(afterEl: HTMLElement, lineNumber: number, side: string) {
  document.querySelectorAll('.annotation-form-container').forEach(el => el.remove());

  const defaultCategory = CATEGORIES[0].value;
  const container = toElement(
    <div className="annotation-form-container">
      <div className="annotation-form">
        {raw(buildCategoryBadge(defaultCategory))}
        <textarea placeholder="Enter your annotation..." autofocus></textarea>
        <div className="annotation-form-actions">
          <button className="btn btn-sm cancel-btn">Cancel</button>
          <button className="btn btn-sm btn-primary annotation-save-btn">Save</button>
        </div>
      </div>
    </div>
  );

  let insertAfter: Element = afterEl;
  let next = afterEl.nextElementSibling;
  while (next && next.classList.contains('annotation-row')) {
    insertAfter = next;
    next = next.nextElementSibling;
  }
  insertAfter.parentNode!.insertBefore(container, insertAfter.nextSibling);

  bindCategoryBadgeClick(container);

  container.querySelector('.cancel-btn')!.addEventListener('click', () => container.remove());

  const textarea = container.querySelector('textarea')!;
  textarea.focus();

  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      saveAnnotation(container, lineNumber, side);
    }
    if (e.key === 'Escape') {
      container.remove();
    }
  });

  container.querySelector('.annotation-save-btn')!.addEventListener('click', () => {
    saveAnnotation(container, lineNumber, side);
  });
}

async function saveAnnotation(container: HTMLElement, lineNumber: number, side: string) {
  const content = (container.querySelector('textarea') as HTMLTextAreaElement).value.trim();
  const category = (container.querySelector('.form-category-badge') as HTMLElement).dataset.category!;
  if (!content) return;

  const annotation = await api('/annotations', {
    method: 'POST',
    body: {
      reviewFileId: state.currentFileId,
      lineNumber,
      side,
      category,
      content,
    },
  });

  container.remove();
  renderAnnotationInline(annotation, lineNumber, side);

  state.annotationCounts[state.currentFileId!] = (state.annotationCounts[state.currentFileId!] || 0) + 1;
  renderFileList();
}
