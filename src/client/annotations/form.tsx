import { delegate } from 'kerfjs';

import type { AnnotationSide } from '../../api/index.js';
import { createAnnotation } from '../../api/index.js';
import { IconCornerDownRight } from '../../icons.js';
import { clearPendingArtifactRegions, takePendingArtifactRegions } from '../diff/noteArtifactRegions.js';
import { asTextarea, toElement } from '../dom.js';
import { asCategory } from '../narrow.js';
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
    const value = asTextarea(textarea).value;
    setEditForm({ ...cur, content: value });
    // Disable Save until there's non-whitespace content (saveNewAnnotation already
    // no-ops on empty, but the button should reflect that). GB-1173.
    const saveBtn = asTextarea(textarea).closest('.annotation-form-container')?.querySelector<HTMLButtonElement>('.annotation-save-btn');
    if (saveBtn !== null && saveBtn !== undefined) saveBtn.disabled = value.trim() === '';
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
        {replyToNoteId !== undefined
          ? <span className="annotation-reply-tag"><IconCornerDownRight /> replying to AI note</span>
          : <span className="annotation-form-anchor">Line {String(lineNumber)}</span>}
        {buildCategoryBadge(defaultCategory)}
        <textarea placeholder={replyToNoteId !== undefined ? 'Reply to this note…' : "Describe the issue and what you'd expect instead…"} autoFocus></textarea>
        <div className="annotation-form-actions">
          <button className="btn btn-sm cancel-btn">Cancel</button>
          <button className="btn btn-sm btn-primary annotation-save-btn" disabled>Save</button>
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
  // Drop any regions the reviewer marked for this note's reply (doc 25 / GB-959)
  // so they don't leak into a later reply.
  if (cur.replyToNoteId !== undefined) clearPendingArtifactRegions(cur.replyToNoteId);
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

  // A reply to a note may carry one or more regions the reviewer marked on the
  // note's image artifact(s) (doc 25 / GB-953, GB-959) — attach them so the
  // reply shows the spots.
  const regions = state.replyToNoteId !== undefined
    ? takePendingArtifactRegions(state.replyToNoteId)
    : [];

  const annotation = await createAnnotation({
    reviewFileId: reviewStore.state.value.currentFileId ?? '',
    lineNumber,
    side: side as AnnotationSide,
    category: asCategory(state.category),
    content,
    replyToNoteId: state.replyToNoteId,
    ...(regions.length > 0 ? { regions } : {}),
  });

  document.querySelectorAll<HTMLElement>(`.annotation-form-container[data-form-key="${state.formKey}"]`).forEach(el => { el.remove(); });
  setEditForm(null);
  renderAnnotationInline(annotation, lineNumber, side);

  const fileId = reviewStore.state.value.currentFileId ?? '';
  const prevCount = reviewStore.state.value.annotationCounts[fileId] ?? 0;
  reviewStore.actions.setAnnotationCount(fileId, prevCount + 1);
}
