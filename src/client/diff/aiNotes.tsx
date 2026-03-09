import { toElement } from '../dom.js';
import type { FileNotes } from '../state.js';
import { state } from '../state.js';

export function renderAINotes(container: HTMLElement, fileId: string) {
  const notes = state.fileNotes[fileId] as FileNotes | undefined;
  if (notes === undefined) return;

  const noteType = state.sortMode === 'risk' ? 'risk' : 'narrative';

  // Render overview note after diff-header
  if (notes.overview !== '') {
    renderOverviewNote(container, notes.overview, noteType);
  }

  // Render line-level notes
  if (notes.lines.length > 0) {
    renderLineNotes(container, notes.lines, noteType);
  }
}

function renderOverviewNote(container: HTMLElement, overview: string, noteType: string) {
  const diffHeader = container.querySelector('.diff-header');
  if (diffHeader === null) return;

  const noteEl = toElement(
    <div className={`ai-note-overview ai-note-${noteType}`}>
      <div className="ai-note-overview-content">
        <span className={`ai-note-label ai-note-label-${noteType}`}>
          {noteType === 'risk' ? 'Risk' : 'Guide'}
        </span>
        <span className="ai-note-text">{overview}</span>
      </div>
    </div>
  );

  diffHeader.after(noteEl);
}

function renderLineNotes(container: HTMLElement, lines: FileNotes['lines'], noteType: string) {
  for (const note of lines) {
    // Try to find the diff line with this line number on the "new" side
    const lineEl = container.querySelector<HTMLElement>(
      `.diff-line[data-line="${String(note.line)}"][data-side="new"]`
    );

    if (lineEl === null) continue;

    // In split mode, insert after the split-row; in unified mode, after the diff-line
    const splitRow = lineEl.closest('.split-row');
    const insertTarget = splitRow ?? lineEl;

    // Skip if there's already an AI note for this line
    if (insertTarget.nextElementSibling?.classList.contains('ai-note-row') === true) continue;

    // Insert before any annotation rows
    const noteEl = toElement(
      <div className={`ai-note-row ai-note-${noteType}`}>
        <div className="ai-note-item">
          <span className={`ai-note-label ai-note-label-${noteType}`}>
            {noteType === 'risk' ? 'Risk' : 'Guide'}
          </span>
          <span className="ai-note-text">{note.content}</span>
        </div>
      </div>
    );

    insertTarget.parentNode?.insertBefore(noteEl, insertTarget.nextSibling);
  }
}
