import { api } from '../api.js';
import { toElement } from '../dom.js';
import { renderFileList } from '../sidebar/fileTree.js';
import type { Annotation } from '../state.js';
import { CATEGORIES } from '../state.js';
import { reviewStore } from '../stores/index.js';
import { bindCategoryBadgeClick,buildCategoryBadge } from './categories.js';
import { renderAnnotationInline } from './render.js';

export function showAnnotationForm(afterEl: HTMLElement, lineNumber: number, side: string) {
  document.querySelectorAll('.annotation-form-container').forEach(el => { el.remove(); });

  const defaultCategory = CATEGORIES[0].value;
  const container = toElement(
    <div className="annotation-form-container">
      <div className="annotation-form">
        {buildCategoryBadge(defaultCategory)}
        <textarea placeholder="Enter your annotation..." autoFocus></textarea>
        <div className="annotation-form-actions">
          <button className="btn btn-sm cancel-btn">Cancel</button>
          <button className="btn btn-sm btn-primary annotation-save-btn">Save</button>
        </div>
      </div>
    </div>
  );

  // In split mode, insert after the split-row (not inside it) so the form spans both columns
  const splitRow = afterEl.closest('.split-row');
  let insertAfter: Element = splitRow ?? afterEl;
  let next = insertAfter.nextElementSibling;
  while (next !== null && next.classList.contains('annotation-row')) {
    insertAfter = next;
    next = next.nextElementSibling;
  }
  insertAfter.parentNode?.insertBefore(container, insertAfter.nextSibling);

  bindCategoryBadgeClick(container);

  container.querySelector('.cancel-btn')?.addEventListener('click', () => { container.remove(); });

  const textarea = container.querySelector('textarea');
  if (textarea !== null) {
    textarea.focus();

    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        void saveAnnotation(container, lineNumber, side);
      }
      if (e.key === 'Escape') {
        container.remove();
      }
    });
  }

  container.querySelector('.annotation-save-btn')?.addEventListener('click', () => {
    void saveAnnotation(container, lineNumber, side);
  });
}

async function saveAnnotation(container: HTMLElement, lineNumber: number, side: string) {
  const content = (container.querySelector('textarea') as HTMLTextAreaElement).value.trim();
  const category = (container.querySelector('.form-category-badge') as HTMLElement).dataset.category ?? '';
  if (content === '') return;

  const annotation = await api<Annotation>('/annotations', {
    method: 'POST',
    body: {
      reviewFileId: reviewStore.state.value.currentFileId,
      lineNumber,
      side,
      category,
      content,
    },
  });

  container.remove();
  renderAnnotationInline(annotation, lineNumber, side);

  const fileId = reviewStore.state.value.currentFileId ?? '';
  const prevCount = reviewStore.state.value.annotationCounts[fileId] ?? 0;
  reviewStore.actions.setAnnotationCount(fileId, prevCount + 1);
  renderFileList();
}
