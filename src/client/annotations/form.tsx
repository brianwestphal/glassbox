import { delegate } from 'kerfjs';

import type { AnnotationCategory, AnnotationSide } from '../../api/index.js';
import { createAnnotation } from '../../api/index.js';
import { asTextarea, toElement } from '../dom.js';
import { CATEGORIES } from '../state.js';
import { editFormSignal, reviewStore, setEditForm } from '../stores/index.js';
import { buildCategoryBadge } from './categories.js';
import { renderAnnotationInline } from './render.js';

/** Register the create-form delegates on the diff container. Called once
 *  from `initDiffView()`. */
export function bindCreateFormEvents(diffContainer: HTMLElement): void {
  void delegate(diffContainer, 'input', '.annotation-form-container[data-form-key] textarea', (_e, textarea) => {
    const cur = editFormSignal.value;
    if (cur === null || cur.formKey === null) return;
    setEditForm({ ...cur, content: asTextarea(textarea).value });
  });

  void delegate(diffContainer, 'keydown', '.annotation-form-container[data-form-key] textarea', (e) => {
    const ke = e as KeyboardEvent;
    if ((ke.metaKey || ke.ctrlKey) && ke.key === 'Enter') {
      ke.preventDefault();
      void saveNewAnnotation();
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      cancelNewAnnotation();
    }
  });

  void delegate(diffContainer, 'click', '.annotation-form-container[data-form-key] .cancel-btn', (e) => {
    e.stopPropagation();
    cancelNewAnnotation();
  });

  void delegate(diffContainer, 'click', '.annotation-form-container[data-form-key] .annotation-save-btn', (e) => {
    e.stopPropagation();
    void saveNewAnnotation();
  });
}

export function showAnnotationForm(afterEl: HTMLElement, lineNumber: number, side: string, replyToNoteId?: string): void {
  // Dismiss any existing create-form (only one open at a time).
  document.querySelectorAll('.annotation-form-container[data-form-key]').forEach(el => { el.remove(); });

  const defaultCategory = CATEGORIES[0].value;
  const formKey = `${String(lineNumber)}:${side}`;

  setEditForm({
    annotationId: null,
    formKey,
    content: '',
    category: defaultCategory,
    replyToNoteId,
  });

  const container = toElement(
    <div className="annotation-form-container" data-form-key={formKey} data-line={String(lineNumber)} data-side={side}>
      <div className={`annotation-form${replyToNoteId !== undefined ? ' annotation-form-reply' : ''}`}>
        {replyToNoteId !== undefined ? <span className="annotation-reply-tag">↳ replying to AI note</span> : null}
        {buildCategoryBadge(defaultCategory)}
        <textarea placeholder={replyToNoteId !== undefined ? 'Reply to this note...' : 'Enter your annotation...'} autoFocus></textarea>
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

  container.querySelector<HTMLTextAreaElement>('textarea')?.focus();
}

function cancelNewAnnotation(): void {
  const cur = editFormSignal.value;
  if (cur?.formKey === null || cur?.formKey === undefined) return;
  document.querySelectorAll<HTMLElement>(`.annotation-form-container[data-form-key="${cur.formKey}"]`).forEach(el => { el.remove(); });
  setEditForm(null);
}

async function saveNewAnnotation(): Promise<void> {
  const state = editFormSignal.value;
  if (state === null || state.formKey === null) return;
  const content = state.content.trim();
  if (content === '') return;
  const [lineNumberStr, side] = state.formKey.split(':');
  const lineNumber = parseInt(lineNumberStr, 10);
  if (isNaN(lineNumber)) return;

  const annotation = await createAnnotation({
    reviewFileId: reviewStore.state.value.currentFileId ?? '',
    lineNumber,
    side: side as AnnotationSide,
    category: state.category as AnnotationCategory,
    content,
    replyToNoteId: state.replyToNoteId,
  });

  document.querySelectorAll<HTMLElement>(`.annotation-form-container[data-form-key="${state.formKey}"]`).forEach(el => { el.remove(); });
  setEditForm(null);
  renderAnnotationInline(annotation, lineNumber, side);

  const fileId = reviewStore.state.value.currentFileId ?? '';
  const prevCount = reviewStore.state.value.annotationCounts[fileId] ?? 0;
  reviewStore.actions.setAnnotationCount(fileId, prevCount + 1);
}
