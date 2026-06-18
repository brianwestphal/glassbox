import { raw } from 'kerfjs';

import { renderNoteMarkdown } from '../../utils/noteMarkdown.js';
import { toElement } from '../dom.js';
import type { FileNotes } from '../state.js';
import { aiStore } from '../stores/index.js';

export function renderAINotes(container: HTMLElement, fileId: string) {
  const ai = aiStore.state.value;

  // Render sort-mode notes (risk or narrative)
  const sortNotes = ai.fileNotes[fileId] as FileNotes | undefined;
  if (sortNotes !== undefined && ai.sortMode !== 'folder') {
    const noteType = ai.sortMode === 'risk' ? 'risk' : 'narrative';
    if (sortNotes.overview !== '') {
      renderOverviewNote(container, sortNotes.overview, noteType);
    }
    if (sortNotes.lines.length > 0) {
      renderLineNotes(container, sortNotes.lines, noteType);
    }
  }

  // Render guided review notes (independent of sort mode)
  const guidedNotes = ai.guidedNotes[fileId] as FileNotes | undefined;
  if (guidedNotes !== undefined && ai.guidedReviewEnabled) {
    if (guidedNotes.overview !== '') {
      renderOverviewNote(container, guidedNotes.overview, 'guided');
    }
    if (guidedNotes.lines.length > 0) {
      renderLineNotes(container, guidedNotes.lines, 'guided');
    }
  }
}

const NOTE_LABELS: Record<string, string> = {
  risk: 'Risk',
  narrative: 'Guide',
  guided: 'Learn',
};

function renderOverviewNote(container: HTMLElement, overview: string, noteType: string) {
  const diffHeader = container.querySelector('.diff-header');
  if (diffHeader === null) return;

  const noteEl = toElement(
    <div className={`ai-note-overview ai-note-${noteType}`}>
      <div className="ai-note-overview-content">
        <span className={`ai-note-label ai-note-label-${noteType}`}>
          {NOTE_LABELS[noteType] ?? noteType}
        </span>
        {/* eslint-disable-next-line kerfjs/no-raw-with-dynamic-arg -- renderNoteMarkdown escapes first; output is safe HTML */}
        <span className="ai-note-text">{raw(renderNoteMarkdown(overview))}</span>
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

    // Skip if there's already an AI note of this type for this line
    let sibling = insertTarget.nextElementSibling;
    let hasDuplicate = false;
    while (sibling !== null && sibling.classList.contains('ai-note-row')) {
      if (sibling.classList.contains(`ai-note-${noteType}`)) { hasDuplicate = true; break; }
      sibling = sibling.nextElementSibling;
    }
    if (hasDuplicate) continue;

    // Insert before any annotation rows
    const noteEl = toElement(
      <div className={`ai-note-row ai-note-${noteType}`}>
        <div className="ai-note-item">
          <span className={`ai-note-label ai-note-label-${noteType}`}>
            {NOTE_LABELS[noteType] ?? noteType}
          </span>
          {/* eslint-disable-next-line kerfjs/no-raw-with-dynamic-arg -- renderNoteMarkdown escapes first; output is safe HTML */}
          <span className="ai-note-text">{raw(renderNoteMarkdown(note.content))}</span>
        </div>
      </div>
    );

    insertTarget.parentNode?.insertBefore(noteEl, insertTarget.nextSibling);
  }
}
