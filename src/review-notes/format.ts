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

/** Heading level body headings are demoted to in the export. The export's own
 *  hierarchy is `## AI Review Notes` / `### <file>`, so a note's headings start
 *  one level below the file heading and can never outrank it. */
const EXPORT_MIN_HEADING = 4;

/** Content indent of a `- ` list item — continuation lines must reach at least
 *  this column to stay inside the item rather than terminating the list. */
const ITEM_INDENT = '  ';

const FENCE_RE = /^\s*(?:```|~~~)/;
const ATX_RE = /^( {0,3})(#{1,6})(\s)/;

/** Split `text` into list-item continuation lines. Blank lines stay truly blank
 *  (indent-only lines are trailing-whitespace noise); every other line is
 *  indented into the item. */
function indentLines(text: string, indent: string): string[] {
  return text.split('\n').map(line => (line.trim() === '' ? '' : indent + line));
}

/**
 * Shift a body's ATX headings so the shallowest sits at `minLevel`, preserving
 * relative structure and capping at h6. Without this, a body that opens with
 * `### Root cause` emits an `<h3>` that competes with the export's own
 * per-file `### <file>` headings, so the document outline the next AI session
 * reads no longer reflects the file grouping. Fenced code is skipped so a
 * `# comment` line in a
 * shell snippet isn't mistaken for a heading.
 */
function demoteHeadings(body: string, minLevel: number): string {
  const lines = body.split('\n');
  const levels: number[] = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    else if (!inFence) {
      const m = ATX_RE.exec(line);
      if (m !== null) levels.push(m[2].length);
    }
  }
  if (levels.length === 0) return body;
  const shift = minLevel - Math.min(...levels);
  if (shift <= 0) return body;

  inFence = false;
  return lines.map(line => {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line.replace(ATX_RE, (_m, pad: string, hashes: string, space: string) =>
      `${pad}${'#'.repeat(Math.min(6, hashes.length + shift))}${space}`);
  }).join('\n');
}

/**
 * Fold one note into a markdown list item. A single-line body stays inline
 * after the label (the common case, unchanged); a multi-line body moves to its
 * own indented block beneath the label, because a continuation line emitted at
 * column 0 would terminate the surrounding list — and leaving a body that opens
 * with a heading or a bullet inline after `label:` would render it as literal
 * text rather than the block it is.
 */
function noteListItem(label: string, body: string): string[] {
  const trimmed = body.replace(/\s+$/, '');
  if (!trimmed.includes('\n')) return [`- ${label}: ${trimmed}`];
  return [`- ${label}`, '', ...indentLines(trimmed, ITEM_INDENT), ''];
}

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
      // No heading demotion here: the prompt delimits its sections with
      // `=== … ===` rather than ATX headings, so a body heading collides with
      // nothing.
      lines.push(...noteListItem(`[${REVIEW_NOTE_LABELS[n.kind] ?? n.kind}, L${String(n.line)}]`, n.body));
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
      lines.push(...noteListItem(`**Line ${String(n.line)}** [${n.kind}]${who}`, demoteHeadings(n.body, EXPORT_MIN_HEADING)));
    }
    lines.push('');
  }
  return lines;
}
