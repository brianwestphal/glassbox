/**
 * Fold AI-authored review notes into the two text surfaces that feed the next
 * step (docs/20 §20.8, P5): the AI-analysis prompt (so risk / narrative /
 * guided analysis is informed by the author's own stated risks, assumptions,
 * and rationale) and the `.glassbox/latest-review.md` export (so the next AI
 * session reads them). Both load the committed `.pr-notes/` notes for the files
 * under review.
 */
import { loadReviewNotesForFile } from './store.js';
import type { ReviewNoteView } from './view.js';
import { REVIEW_NOTE_LABELS } from './view.js';

function notesByFile(repoRoot: string, filePaths: string[]): { file: string; notes: ReviewNoteView[] }[] {
  const out: { file: string; notes: ReviewNoteView[] }[] = [];
  for (const file of filePaths) {
    const notes = loadReviewNotesForFile(repoRoot, file);
    if (notes.length > 0) out.push({ file, notes });
  }
  return out;
}

/** A prompt section listing the author's review notes per file, or `''` if
 *  there are none. Appended to the analysis prompt. */
export function reviewNotesPromptSection(repoRoot: string, filePaths: string[]): string {
  const grouped = notesByFile(repoRoot, filePaths);
  if (grouped.length === 0) return '';
  const lines = [
    '=== Author review notes ===',
    'The author (an AI tool) left line-anchored notes explaining these changes. Use them to inform your analysis — weight their stated risks and assumptions.',
    '',
  ];
  for (const { file, notes } of grouped) {
    lines.push(`${file}:`);
    for (const n of notes) {
      lines.push(`- [${REVIEW_NOTE_LABELS[n.kind] ?? n.kind}, L${String(n.line)}] ${n.body}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** Markdown lines for an "AI Review Notes" export section, or `[]` if there are
 *  none. Spliced into `.glassbox/latest-review.md`. */
export function reviewNotesExportSection(repoRoot: string, filePaths: string[]): string[] {
  const grouped = notesByFile(repoRoot, filePaths);
  if (grouped.length === 0) return [];
  const lines = [
    '## AI Review Notes',
    '',
    '> Line-anchored notes the generating AI left explaining its changes (from `.pr-notes/`). Read these for the rationale and proof behind the code.',
    '',
  ];
  for (const { file, notes } of grouped) {
    lines.push(`### ${file}`);
    lines.push('');
    for (const n of notes) {
      const who = n.producer !== undefined ? ` _(${n.producer})_` : '';
      lines.push(`- **Line ${String(n.line)}** [${n.kind}]: ${n.body}${who}`);
    }
    lines.push('');
  }
  return lines;
}
