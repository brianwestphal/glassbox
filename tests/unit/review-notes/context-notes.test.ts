/**
 * GB-1139 — review notes surfaced when a collapsed diff region is expanded.
 * `reanchorNotesForRange` scopes + de-stales notes to the revealed range;
 * `renderContextNotes` groups + renders them (with nested replies).
 */
import { describe, expect, it } from 'vitest';

import type { Annotation } from '../../../src/db/queries.js';
import { reanchorNotesForRange, renderContextNotes } from '../../../src/review-notes/context-notes.js';
import type { ReviewNoteView } from '../../../src/review-notes/view.js';

function note(over: Partial<ReviewNoteView> = {}): ReviewNoteView {
  return { guid: 'g1', line: 5, side: 'new', kind: 'rationale', body: 'why', ...over };
}

/** A revealed range: lines `from..to` with `content(n)` text. */
function range(from: number, to: number, content: (n: number) => string) {
  const lines = [];
  for (let n = from; n <= to; n++) lines.push({ num: n, content: content(n) });
  return lines;
}

describe('reanchorNotesForRange (GB-1139)', () => {
  const lines = range(1, 10, n => `line ${n}`);

  it('keeps a note whose snippet still matches its line in the range', () => {
    const kept = reanchorNotesForRange([note({ line: 5, snippet: 'line 5' })], 'f.ts', 1, 10, lines);
    expect(kept.map(n => n.line)).toEqual([5]);
    expect(kept[0].stale).not.toBe(true);
  });

  it('drops a note whose snippet no longer matches (stale hidden)', () => {
    const kept = reanchorNotesForRange([note({ line: 5, snippet: 'totally different code' })], 'f.ts', 1, 10, lines);
    expect(kept).toEqual([]);
  });

  it('drops a note anchored outside the revealed range', () => {
    const kept = reanchorNotesForRange([note({ line: 99, snippet: 'line 99' })], 'f.ts', 1, 10, lines);
    expect(kept).toEqual([]);
  });

  it('keeps a note with no snippet (staleness unknowable) if it is in range', () => {
    const kept = reanchorNotesForRange([note({ line: 5, snippet: undefined })], 'f.ts', 1, 10, lines);
    expect(kept.map(n => n.line)).toEqual([5]);
  });

  it('follows a note whose line shifted but whose snippet still matches nearby', () => {
    // Snippet is "line 7" but the note was authored at line 5; re-anchor moves it to 7.
    const kept = reanchorNotesForRange([note({ line: 5, snippet: 'line 7' })], 'f.ts', 1, 10, lines);
    expect(kept.map(n => n.line)).toEqual([7]);
  });

  it('ignores old-side notes (notes anchor to the new side)', () => {
    const kept = reanchorNotesForRange([note({ line: 5, side: 'old', snippet: 'line 5' })], 'f.ts', 1, 10, lines);
    expect(kept).toEqual([]);
  });
});

describe('renderContextNotes (GB-1139)', () => {
  it('returns nothing for no notes', () => {
    expect(renderContextNotes([], [])).toEqual([]);
  });

  it('groups notes by line and renders review-note markup', () => {
    const out = renderContextNotes([note({ guid: 'a', line: 5, body: 'hello note' })], []);
    expect(out).toHaveLength(1);
    expect(out[0].line).toBe(5);
    expect(out[0].html).toContain('ai-note-row');
    expect(out[0].html).toContain('hello note');
  });

  it('nests a human reply beneath its note', () => {
    const reply: Annotation = {
      id: 'r1', review_file_id: 'f', line_number: 5, side: 'new',
      category: 'note', content: 'my reply', created_at: '', is_stale: false,
      reply_to_note_id: 'a', region_data: null,
    } as unknown as Annotation;
    const out = renderContextNotes([note({ guid: 'a', line: 5 })], [reply]);
    expect(out[0].html).toContain('my reply');
  });

  it('sorts output lines ascending', () => {
    const out = renderContextNotes([note({ guid: 'a', line: 9 }), note({ guid: 'b', line: 3 })], []);
    expect(out.map(o => o.line)).toEqual([3, 9]);
  });
});
