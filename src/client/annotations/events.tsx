import { delegate, morph } from 'kerfjs';

import { deleteAnnotation, keepAnnotation, updateAnnotation } from '../../api/index.js';
import { asEl, asElement, asElOrNull, asTextarea, cssEscape, toElement } from '../dom.js';
import { asCategory } from '../narrow.js';
import type { Annotation } from '../state.js';
import {
  dragStore,
  editFormSignal,
  reviewStore,
  setEditForm,
} from '../stores/index.js';
import { bindAttachmentEvents } from './attachments.js';
import { buildCategoryBadge } from './categories.js';
import { showReclassifyPopup } from './reclassifyPopup.js';
import { buildAnnotationItemHtml } from './render.js';

/** Register all annotation-related delegates on the diff container. Called
 *  once from `initDiffView()`. Annotations are server-rendered inline in the
 *  diff HTML (under a `data-morph-skip` wrapper from Phase 4) — these
 *  delegated handlers fire for every annotation row, current and future,
 *  without ever needing per-element `addEventListener`. */
export function bindAnnotationEvents(diffContainer: HTMLElement): void {
  // Attachment chips/upload/preview delegates (doc 25) — same once-per-surface
  // model as the annotation handlers below.
  bindAttachmentEvents(diffContainer);

  void delegate(diffContainer, 'click', '.annotation-item [data-action="delete"]', (e, btn) => {
    e.stopPropagation();
    const item = asEl(btn).closest<HTMLElement>('.annotation-item');
    if (item === null) return;
    void handleDelete(item);
  });

  void delegate(diffContainer, 'click', '.annotation-item [data-action="edit"]', (e, btn) => {
    e.stopPropagation();
    const item = asEl(btn).closest<HTMLElement>('.annotation-item');
    if (item === null) return;
    startEdit(item);
  });

  void delegate(diffContainer, 'dblclick', '.annotation-item', (e, item) => {
    e.stopPropagation();
    const el = asEl(item);
    if (el.querySelector('.annotation-form') !== null) return;
    if (asElement(e.target).closest('.annotation-form-container') !== null) return;
    startEdit(el);
  });

  void delegate(diffContainer, 'click', '.annotation-item [data-action="reclassify"]', (e, badge) => {
    e.stopPropagation();
    const item = asEl(badge).closest<HTMLElement>('.annotation-item');
    if (item === null) return;
    const annotation = readAnnotation(item);
    if (annotation === null) return;
    showReclassifyPopup(asEl(badge), item, annotation);
  });

  void delegate(diffContainer, 'click', '.annotation-item [data-action="keep"]', (e, btn) => {
    e.stopPropagation();
    const item = asEl(btn).closest<HTMLElement>('.annotation-item');
    if (item === null) return;
    void handleKeep(item);
  });

  void delegate(diffContainer, 'dragstart', '.annotation-drag-handle', (e, handle) => {
    e.stopPropagation();
    const item = asEl(handle).closest<HTMLElement>('.annotation-item');
    if (item === null) return;
    const annotation = readAnnotation(item);
    if (annotation === null) return;
    dragStore.actions.setAnnotation({ id: annotation.id, item, annotation });
    const de = e as DragEvent;
    if (de.dataTransfer !== null) {
      de.dataTransfer.effectAllowed = 'move';
      de.dataTransfer.setData('text/plain', annotation.id);
    }
  });

  // Edit-form delegates. Scoped to `[data-edit-for]` so the equivalent
  // create-form delegates in `form.tsx` (which target `[data-form-key]`)
  // don't double-fire — both forms reuse the `.annotation-form` shell.
  void delegate(diffContainer, 'click', '.annotation-form-container[data-edit-for] .cancel-edit', (e) => {
    e.stopPropagation();
    cancelEdit();
  });

  void delegate(diffContainer, 'click', '.annotation-form-container[data-edit-for] .save-edit', (e) => {
    e.stopPropagation();
    void saveEdit();
  });

  void delegate(diffContainer, 'input', '.annotation-form-container[data-edit-for] textarea', (_e, textarea) => {
    const cur = editFormSignal.value;
    if (cur === null) return;
    setEditForm({ ...cur, content: asTextarea(textarea).value });
  });

  void delegate(diffContainer, 'keydown', '.annotation-form-container[data-edit-for] textarea', (e) => {
    const ke = e as KeyboardEvent;
    if ((ke.metaKey || ke.ctrlKey) && ke.key === 'Enter') {
      ke.preventDefault();
      void saveEdit();
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      cancelEdit();
    }
  });

  // Form category badge → opens the category picker. Matches both the
  // edit form (`[data-edit-for]`) and the create form (`[data-form-key]`),
  // since `showCategoryPickerForBadge` writes back through the shared
  // `editFormSignal` either way. Restricting this to `[data-edit-for]`
  // silently broke type changes during initial annotation entry — the
  // picker would open via the badge click, but no option click handler
  // would fire because there was no delegate match.
  void delegate(diffContainer, 'click', '.annotation-form-container .form-category-badge', (e, badge) => {
    e.stopPropagation();
    showReclassifyPopupForEdit(asEl(badge));
  });
}

function readAnnotation(item: HTMLElement): Annotation | null {
  const id = item.dataset.annotationId;
  if (id === undefined || id === '') return null;
  const category = item.querySelector('.annotation-category')?.textContent ?? '';
  const content = item.querySelector('.annotation-text')?.textContent ?? '';
  const isStale = item.dataset.isStale === 'true';
  // Preserve the artifact-region marker across re-renders (GB-953) so an
  // edit/keep morph doesn't drop a reply's marked-region thumbnail.
  const regionData = item.dataset.regionData ?? null;
  return { id, category, content, is_stale: isStale, region_data: regionData };
}

async function handleDelete(item: HTMLElement): Promise<void> {
  const annotation = readAnnotation(item);
  if (annotation === null) return;
  const annotationRow = item.closest<HTMLElement>('.annotation-row');
  const lineEl = asElOrNull(annotationRow?.previousElementSibling);

  await deleteAnnotation({ id: annotation.id });
  item.remove();
  if (annotationRow !== null && annotationRow.querySelector('.annotation-item') === null) {
    annotationRow.remove();
    lineEl?.classList.remove('has-annotation');
  }
  const fileId = reviewStore.state.value.currentFileId ?? '';
  const ann = reviewStore.state.value.annotationCounts[fileId] ?? 1;
  reviewStore.actions.setAnnotationCount(fileId, Math.max(0, ann - 1));
  if (annotation.is_stale) {
    const stale = reviewStore.state.value.staleCounts[fileId] ?? 1;
    reviewStore.actions.setStaleCount(fileId, Math.max(0, stale - 1));
  }
}

async function handleKeep(item: HTMLElement): Promise<void> {
  const annotation = readAnnotation(item);
  if (annotation === null) return;
  await keepAnnotation({ id: annotation.id });
  const updated = { ...annotation, is_stale: false };
  item.classList.remove('annotation-stale');
  delete item.dataset.isStale;
  morph(item, buildAnnotationItemHtml(updated));
  const fileId = reviewStore.state.value.currentFileId ?? '';
  const stale = reviewStore.state.value.staleCounts[fileId] ?? 1;
  reviewStore.actions.setStaleCount(fileId, Math.max(0, stale - 1));
}

function startEdit(item: HTMLElement): void {
  const annotation = readAnnotation(item);
  if (annotation === null) return;
  const annotationRow = item.closest<HTMLElement>('.annotation-row');
  if (annotationRow === null) return;

  // Seed the edit-form signal so any concurrent re-render reads the same
  // content/category we're about to put in the textarea.
  setEditForm({
    annotationId: annotation.id,
    formKey: null,
    content: annotation.content,
    category: annotation.category,
  });

  const formContainer = toElement(
    <div className="annotation-form-container" data-edit-for={annotation.id}>
      <div className="annotation-form">
        {buildCategoryBadge(annotation.category)}
        <textarea>{annotation.content}</textarea>
        <div className="annotation-form-actions">
          <button className="btn btn-sm cancel-edit">Cancel</button>
          <button className="btn btn-sm btn-primary save-edit">Save</button>
        </div>
      </div>
    </div>
  );

  item.style.display = 'none';
  annotationRow.parentNode?.insertBefore(formContainer, annotationRow.nextSibling);

  const textarea = formContainer.querySelector<HTMLTextAreaElement>('textarea');
  if (textarea !== null) {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }
}

function cancelEdit(): void {
  closeEditForm();
}

async function saveEdit(): Promise<void> {
  const state = editFormSignal.value;
  if (state === null || state.annotationId === null) return;
  const content = state.content.trim();
  if (content === '') return;

  await updateAnnotation({
    id: state.annotationId,
    content,
    category: asCategory(state.category),
  });

  const item = findAnnotationItem(state.annotationId);
  if (item !== null) {
    const updated: Annotation = {
      id: state.annotationId,
      category: state.category,
      content,
      is_stale: item.dataset.isStale === 'true',
    };
    morph(item, buildAnnotationItemHtml(updated));
    item.style.display = '';
  }
  closeEditForm();
}

function closeEditForm(): void {
  const state = editFormSignal.value;
  const id = state?.annotationId ?? null;
  setEditForm(null);
  if (id !== null) {
    document.querySelectorAll<HTMLElement>(`.annotation-form-container[data-edit-for="${cssEscape(id)}"]`).forEach(el => { el.remove(); });
    const item = findAnnotationItem(id);
    if (item !== null) item.style.display = '';
  }
}

function findAnnotationItem(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.annotation-item[data-annotation-id="${cssEscape(id)}"]`);
}

function showReclassifyPopupForEdit(badge: HTMLElement): void {
  // The edit-form badge — picker writes the chosen category back into the
  // form signal AND updates the badge DOM, so a subsequent save reads the
  // right category.
  void import('./reclassifyPopup.js').then(({ showCategoryPickerForBadge }) => {
    showCategoryPickerForBadge(badge);
  });
}

// Expose `closeEditForm` so the diff view's outside-click handler (if any)
// can dismiss the picker without reaching into module internals.
export { closeEditForm };
