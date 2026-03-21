import type { SafeHtml } from '../../jsx-runtime.js';
import { toElement } from '../dom.js';
import type { Annotation } from '../state.js';
import { IconEdit, IconTrash } from '../../icons.js';
import { bindAnnotationItemEvents } from './events.js';

export function buildAnnotationItemHtml(annotation: Annotation): SafeHtml {
  return (
    <>
      <span className="annotation-drag-handle" draggable={true} title="Drag to move">{'\u2807'}</span>
      <span className={`annotation-category category-${annotation.category}`} data-action="reclassify">{annotation.category}</span>
      <span className="annotation-text">{annotation.content}</span>
      <div className="annotation-actions">
        {annotation.is_stale && <button className="btn btn-xs btn-keep" data-action="keep">Keep</button>}
        <button className="btn btn-xs btn-icon" data-action="edit" title="Edit"><IconEdit /></button>
        <button className="btn btn-xs btn-icon btn-danger" data-action="delete" title="Delete"><IconTrash /></button>
      </div>
    </>
  );
}

export function renderAnnotationInline(annotation: Annotation, lineNumber: number, side: string) {
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

  const item = toElement(
    <div className={`annotation-item${annotation.is_stale ? ' annotation-stale' : ''}`}
         data-annotation-id={annotation.id}
         data-is-stale={annotation.is_stale ? 'true' : undefined}>
      {buildAnnotationItemHtml(annotation)}
    </div>
  );

  bindAnnotationItemEvents(item, annotation, lineEl as HTMLElement, annotationRow as HTMLElement);
  annotationRow.appendChild(item);
}
