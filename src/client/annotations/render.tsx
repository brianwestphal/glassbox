import type { SafeHtml } from 'kerfjs';

import { ReviewNoteRegionThumb } from '../../components/reviewNoteRegionThumb.js';
import { IconCornerDownRight, IconEdit, IconGripVertical, IconPaperclip, IconTrash } from '../../icons.js';
import { toElement } from '../dom.js';
import type { Annotation } from '../state.js';

export function buildAnnotationItemHtml(annotation: Annotation): SafeHtml {
  return (
    <>
      <span className="annotation-drag-handle" draggable="true" title="Drag to move"><IconGripVertical /></span>
      <span className={`annotation-category category-${annotation.category}`} data-action="reclassify">{annotation.category}</span>
      {annotation.reply_to_note_id !== null && annotation.reply_to_note_id !== undefined && <span className="annotation-reply-tag" title="Reply to an AI review note"><IconCornerDownRight /> reply</span>}
      <span className="annotation-text">{annotation.content}</span>
      {ReviewNoteRegionThumb({ regionData: annotation.region_data })}
      <div className="annotation-actions">
        {annotation.is_stale && <button className="btn btn-xs btn-keep" data-action="keep">Keep</button>}
        <button className="btn btn-xs btn-icon" data-action="attach" title="Attach a file"><IconPaperclip /></button>
        <button className="btn btn-xs btn-icon" data-action="edit" title="Edit"><IconEdit /></button>
        <button className="btn btn-xs btn-icon btn-danger" data-action="delete" title="Delete"><IconTrash /></button>
      </div>
      <div className="annotation-attachments" data-att-list={annotation.id} data-morph-skip></div>
    </>
  );
}

export function renderAnnotationInline(annotation: Annotation, lineNumber: number, side: string): void {
  const lineEl = document.querySelector(`.diff-line[data-line="${String(lineNumber)}"][data-side="${side}"]`);
  if (!lineEl) return;

  lineEl.classList.add('has-annotation');

  // In split mode, insert after the split-row (not inside it) so annotations span both columns
  const splitRow = lineEl.closest('.split-row');
  const insertTarget = splitRow ?? lineEl;

  let annotationRow = insertTarget.nextElementSibling;
  if (!annotationRow || !annotationRow.classList.contains('annotation-row')) {
    annotationRow = toElement(<div className="annotation-row"></div>);
    insertTarget.parentNode?.insertBefore(annotationRow, insertTarget.nextSibling);
  }

  // Per-item event handlers are gone — `delegate()` on the diff container
  // (set up by `bindAnnotationEvents()`) handles every interaction by
  // matching `data-action` attributes on the rendered buttons.
  const item = toElement(
    <div className={`annotation-item${annotation.is_stale ? ' annotation-stale' : ''}`}
         data-key={annotation.id}
         data-annotation-id={annotation.id}
         data-is-stale={annotation.is_stale ? 'true' : undefined}
         data-region-data={annotation.region_data ?? undefined}>
      {buildAnnotationItemHtml(annotation)}
    </div>
  );

  annotationRow.appendChild(item);
}
