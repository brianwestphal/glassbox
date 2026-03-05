import { raw } from '../../jsx-runtime.js';
import { state, CATEGORIES } from '../state.js';
import type { Annotation } from '../state.js';
import { api } from '../api.js';
import { toElement } from '../dom.js';
import { renderFileList } from '../sidebar/fileTree.js';
import { buildAnnotationItemHtml } from './render.js';
import { buildCategoryBadge, bindCategoryBadgeClick } from './categories.js';

export function bindAnnotationItemEvents(item: HTMLElement, annotation: Annotation, lineEl: HTMLElement, annotationRow: HTMLElement) {
  item.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await api('/annotations/' + annotation.id, { method: 'DELETE' });
    item.remove();
    if (annotationRow && !annotationRow.querySelector('.annotation-item')) {
      annotationRow.remove();
      if (lineEl) lineEl.classList.remove('has-annotation');
    }
    state.annotationCounts[state.currentFileId!] = Math.max(0, (state.annotationCounts[state.currentFileId!] || 1) - 1);
    if (annotation.is_stale) {
      state.staleCounts[state.currentFileId!] = Math.max(0, (state.staleCounts[state.currentFileId!] || 1) - 1);
    }
    renderFileList();
  });

  item.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    editAnnotation(item, annotation);
  });

  item.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (item.querySelector('.annotation-form')) return;
    editAnnotation(item, annotation);
  });

  item.querySelector('[data-action="reclassify"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showReclassifyPopup((e.target as HTMLElement).closest('[data-action="reclassify"]') as HTMLElement, item, annotation);
  });

  item.querySelector('[data-action="keep"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await api('/annotations/' + annotation.id + '/keep', { method: 'POST' });
    annotation.is_stale = false;
    item.classList.remove('annotation-stale');
    delete item.dataset.isStale;
    item.innerHTML = buildAnnotationItemHtml(annotation);
    bindAnnotationItemEvents(item, annotation, lineEl, annotationRow);
    state.staleCounts[state.currentFileId!] = Math.max(0, (state.staleCounts[state.currentFileId!] || 1) - 1);
    renderFileList();
  });

  const handle = item.querySelector('.annotation-drag-handle');
  if (handle) {
    handle.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      state._dragAnnotation = { id: annotation.id, item: item, annotation: annotation };
      (e as DragEvent).dataTransfer!.effectAllowed = 'move';
      (e as DragEvent).dataTransfer!.setData('text/plain', annotation.id);
    });
  }
}

export function bindServerAnnotations() {
  document.querySelectorAll('.annotation-item').forEach(el => {
    const item = el as HTMLElement;
    const id = item.dataset.annotationId;
    if (!id) return;
    const isStale = item.dataset.isStale === 'true';
    const category = item.querySelector('.annotation-category')?.textContent || '';
    const content = item.querySelector('.annotation-text')?.textContent || '';
    const annotation: Annotation = { id, category, content, is_stale: isStale };
    const row = item.closest('.annotation-row') as HTMLElement;
    const lineEl = row ? row.previousElementSibling as HTMLElement : null;
    bindAnnotationItemEvents(item, annotation, lineEl!, row);
  });
}

function showReclassifyPopup(badge: HTMLElement, item: HTMLElement, annotation: Annotation) {
  document.querySelectorAll('.reclassify-popup').forEach(el => el.remove());

  const rect = badge.getBoundingClientRect();
  const optionsHtml = CATEGORIES.map(c => (
    <div className={`reclassify-option${c.value === annotation.category ? ' active' : ''}`} data-value={c.value}>
      <span className={`annotation-category category-${c.value}`}>{c.label}</span>
    </div>
  ).toString()).join('');
  const popup = toElement(
    <div className="reclassify-popup" style={`position:fixed;left:${rect.left}px;top:${rect.bottom + 4}px;z-index:1000`}>
      {raw(optionsHtml)}
    </div>
  );

  popup.addEventListener('click', async (e) => {
    const opt = (e.target as HTMLElement).closest('.reclassify-option') as HTMLElement | null;
    if (!opt) return;
    e.stopPropagation();
    const newCategory = opt.dataset.value!;
    if (newCategory === annotation.category) { popup.remove(); return; }
    annotation.category = newCategory;
    await api('/annotations/' + annotation.id, { method: 'PATCH', body: { content: annotation.content, category: newCategory } });
    item.innerHTML = buildAnnotationItemHtml(annotation);
    const row = item.closest('.annotation-row') as HTMLElement;
    const lineElRef = row ? row.previousElementSibling as HTMLElement : null;
    bindAnnotationItemEvents(item, annotation, lineElRef!, row);
    popup.remove();
  });

  document.body.appendChild(popup);
  const closePopup = (e: Event) => {
    if (!popup.contains(e.target as Node)) {
      popup.remove();
      document.removeEventListener('click', closePopup, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closePopup, true), 0);
}

function editAnnotation(item: HTMLElement, annotation: Annotation) {
  const annotationRow = item.closest('.annotation-row') as HTMLElement;
  const formContainer = toElement(
    <div className="annotation-form-container">
      <div className="annotation-form">
        {raw(buildCategoryBadge(annotation.category))}
        <textarea>{annotation.content}</textarea>
        <div className="annotation-form-actions">
          <button className="btn btn-sm cancel-edit">Cancel</button>
          <button className="btn btn-sm btn-primary save-edit">Save</button>
        </div>
      </div>
    </div>
  );

  item.style.display = 'none';
  annotationRow.parentNode!.insertBefore(formContainer, annotationRow.nextSibling);

  bindCategoryBadgeClick(formContainer);

  function cancelEdit() {
    item.style.display = '';
    formContainer.remove();
  }

  formContainer.querySelector('.cancel-edit')!.addEventListener('click', (e) => {
    e.stopPropagation();
    cancelEdit();
  });

  formContainer.querySelector('.save-edit')!.addEventListener('click', async (e) => {
    e.stopPropagation();
    const content = (formContainer.querySelector('textarea') as HTMLTextAreaElement).value.trim();
    const category = (formContainer.querySelector('.form-category-badge') as HTMLElement).dataset.category!;
    if (!content) return;
    annotation.content = content;
    annotation.category = category;
    await api('/annotations/' + annotation.id, { method: 'PATCH', body: { content, category } });
    item.innerHTML = buildAnnotationItemHtml(annotation);
    const row = item.closest('.annotation-row') as HTMLElement;
    const lineEl = row ? row.previousElementSibling as HTMLElement : null;
    bindAnnotationItemEvents(item, annotation, lineEl!, row);
    item.style.display = '';
    formContainer.remove();
  });

  const textarea = formContainer.querySelector('textarea')!;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      (formContainer.querySelector('.save-edit') as HTMLElement).click();
    }
    if (e.key === 'Escape') {
      cancelEdit();
    }
  });
}
