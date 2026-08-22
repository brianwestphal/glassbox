import { renderReviewNoteRowsHtml } from '../components/diffView.js';
import type { Annotation } from '../db/queries.js';
import type { FileDiff } from '../git/types.js';
import { reanchorReviewNotes } from './reanchor.js';
import type { ReviewNoteView } from './view.js';

/** A revealed line's server-rendered review-note rows (doc 20 §20.6, GB-1139). */
export interface ContextNoteHtml {
  line: number;
  html: string;
}

/**
 * Re-anchor `rawNotes` against a revealed context range and keep only those that
 * belong in it (doc 20 §20.6, GB-1139). The range is unchanged working-tree
 * lines, so it's modeled as a synthetic all-context `FileDiff`; re-anchoring
 * follows a note whose line shifted and flags one whose snippet no longer
 * matches. We keep new-side notes whose (re-anchored) line falls in
 * `[start,end]` and drop **stale** ones — the user's "hide stale" choice for
 * this reveal path.
 */
export function reanchorNotesForRange(
  rawNotes: ReviewNoteView[],
  filePath: string,
  start: number,
  end: number,
  lines: { num: number; content: string }[],
): ReviewNoteView[] {
  const syntheticDiff: FileDiff = {
    filePath,
    oldPath: null,
    status: 'unchanged',
    isBinary: false,
    hunks: lines.length === 0 ? [] : [{
      oldStart: start,
      oldCount: lines.length,
      newStart: start,
      newCount: lines.length,
      lines: lines.map(l => ({ type: 'context' as const, oldNum: l.num, newNum: l.num, content: l.content })),
    }],
  };
  return reanchorReviewNotes(rawNotes, syntheticDiff)
    .filter(n => n.side === 'new' && n.line >= start && n.line <= end && n.stale !== true);
}

/**
 * Group the surviving notes by line and server-render each line's rows (with any
 * human replies nested), returning `{ line, html }` for the client to splice
 * into the revealed diff. Pure aside from the shared note renderer.
 */
export function renderContextNotes(
  anchored: ReviewNoteView[],
  annotations: Annotation[],
  filePath: string,
): ContextNoteHtml[] {
  if (anchored.length === 0) return [];
  const loaded = new Set(anchored.map(n => n.guid).filter((g): g is string => g !== undefined));
  const repliesByNote: Record<string, Annotation[]> = {};
  for (const a of annotations) {
    if (a.reply_to_note_id !== null && loaded.has(a.reply_to_note_id)) {
      (repliesByNote[a.reply_to_note_id] ??= []).push(a);
    }
  }
  const byLine = new Map<number, ReviewNoteView[]>();
  for (const n of anchored) {
    const arr = byLine.get(n.line) ?? [];
    arr.push(n);
    byLine.set(n.line, arr);
  }
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, ns]) => ({ line, html: renderReviewNoteRowsHtml(ns, repliesByNote, filePath) }));
}
