import { raw } from '../../jsx-runtime.js';
import { toElement } from '../dom.js';
import type { Annotation } from '../state.js';
import { bindAnnotationItemEvents } from './events.js';

const ICON_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const ICON_EDIT = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';

export function buildAnnotationItemHtml(annotation: Annotation): string {
  return (
    <>
      <span className="annotation-drag-handle" draggable={true} title="Drag to move">{'\u2807'}</span>
      <span className={`annotation-category category-${annotation.category}`} data-action="reclassify">{annotation.category}</span>
      <span className="annotation-text">{annotation.content}</span>
      <div className="annotation-actions">
        {annotation.is_stale && <button className="btn btn-xs btn-keep" data-action="keep">Keep</button>}
        <button className="btn btn-xs btn-icon" data-action="edit" title="Edit">{raw(ICON_EDIT)}</button>
        <button className="btn btn-xs btn-icon btn-danger" data-action="delete" title="Delete">{raw(ICON_TRASH)}</button>
      </div>
    </>
  ).toString();
}

export function renderAnnotationInline(annotation: Annotation, lineNumber: number, side: string) {
  const lineEl = document.querySelector(`.diff-line[data-line="${String(lineNumber)}"][data-side="${side}"]`);
  if (!lineEl) return;

  lineEl.classList.add('has-annotation');

  let annotationRow = lineEl.nextElementSibling;
  if (!annotationRow || !annotationRow.classList.contains('annotation-row')) {
    annotationRow = toElement(<div className="annotation-row"></div>);
    lineEl.parentNode?.insertBefore(annotationRow, lineEl.nextSibling);
  }

  const item = toElement(
    <div className={`annotation-item${annotation.is_stale ? ' annotation-stale' : ''}`}
         data-annotation-id={annotation.id}
         data-is-stale={annotation.is_stale ? 'true' : undefined}>
      {raw(buildAnnotationItemHtml(annotation))}
    </div>
  );

  bindAnnotationItemEvents(item, annotation, lineEl as HTMLElement, annotationRow as HTMLElement);
  annotationRow.appendChild(item);
}
