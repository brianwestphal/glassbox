/**
 * GB-897 (P3) — re-anchoring review notes against the current diff: aligned /
 * shifted / changed-to-stale / untouched cases.
 */
import { describe, expect, it } from 'vitest';

import type { FileDiff } from '../../../src/git/diff.js';
import { reanchorReviewNotes } from '../../../src/review-notes/reanchor.js';
import type { ReviewNoteView } from '../../../src/review-notes/view.js';

function diffWithNewLines(lines: { newNum: number; content: string }[]): FileDiff {
  return {
    filePath: 'src/x.ts', oldPath: null, status: 'modified', isBinary: false,
    hunks: [{
      oldStart: 1, oldCount: 0, newStart: 1, newCount: lines.length,
      lines: lines.map(l => ({ type: 'add' as const, oldNum: null, newNum: l.newNum, content: l.content })),
    }],
  };
}

function note(overrides: Partial<ReviewNoteView>): ReviewNoteView {
  return { line: 1, side: 'new', kind: 'rationale', body: 'b', ...overrides };
}

describe('reanchorReviewNotes', () => {
  it('leaves a note untouched when its snippet still matches its line', () => {
    const diff = diffWithNewLines([{ newNum: 5, content: 'const x = 1;' }]);
    const [n] = reanchorReviewNotes([note({ line: 5, snippet: 'const x = 1;' })], diff);
    expect(n.line).toBe(5);
    expect(n.stale).toBeUndefined();
  });

  it('re-anchors a note to the line its authored text moved to', () => {
    const diff = diffWithNewLines([
      { newNum: 5, content: 'inserted();' },
      { newNum: 8, content: 'const x = 1;' },
    ]);
    const [n] = reanchorReviewNotes([note({ line: 5, snippet: 'const x = 1;' })], diff);
    expect(n.line).toBe(8);
    expect(n.stale).toBe(false);
  });

  it('flags a note stale when its line is shown but the text is gone', () => {
    const diff = diffWithNewLines([{ newNum: 5, content: 'const x = 2; // changed' }]);
    const [n] = reanchorReviewNotes([note({ line: 5, snippet: 'const x = 1;' })], diff);
    expect(n.line).toBe(5);
    expect(n.stale).toBe(true);
  });

  it('leaves a note untouched when its line is not in the diff (cannot judge)', () => {
    const diff = diffWithNewLines([{ newNum: 100, content: 'far away' }]);
    const [n] = reanchorReviewNotes([note({ line: 5, snippet: 'const x = 1;' })], diff);
    expect(n.line).toBe(5);
    expect(n.stale).toBeUndefined();
  });

  it('leaves a note without a snippet untouched', () => {
    const diff = diffWithNewLines([{ newNum: 5, content: 'whatever' }]);
    const [n] = reanchorReviewNotes([note({ line: 5 })], diff);
    expect(n.line).toBe(5);
    expect(n.stale).toBeUndefined();
  });

  it('picks the nearest match when the authored text appears more than once', () => {
    const diff = diffWithNewLines([
      { newNum: 2, content: 'dup();' },
      { newNum: 9, content: 'dup();' },
    ]);
    const [n] = reanchorReviewNotes([note({ line: 7, snippet: 'dup();' })], diff);
    expect(n.line).toBe(9); // distance 2 vs 5
  });

  // GB-1139 Windows regression: a file checked out with CRLF yields `"code\r"`
  // line content, which must still match the LF-authored `"code"` snippet — else
  // every note goes stale on Windows (this broke the notes-reveal e2e there).
  it('matches CRLF diff content against an LF-authored snippet (aligned)', () => {
    const diff = diffWithNewLines([{ newNum: 5, content: 'const x = 1;\r' }]);
    const [n] = reanchorReviewNotes([note({ line: 5, snippet: 'const x = 1;' })], diff);
    expect(n.line).toBe(5);
    expect(n.stale).toBeUndefined();
  });

  it('matches CRLF diff content when re-anchoring to a shifted line', () => {
    const diff = diffWithNewLines([
      { newNum: 5, content: 'inserted();\r' },
      { newNum: 8, content: 'const x = 1;\r' },
    ]);
    const [n] = reanchorReviewNotes([note({ line: 5, snippet: 'const x = 1;' })], diff);
    expect(n.line).toBe(8);
    expect(n.stale).toBe(false);
  });

  it('matches a CRLF-authored snippet against LF content (symmetric)', () => {
    const diff = diffWithNewLines([{ newNum: 5, content: 'const x = 1;' }]);
    const [n] = reanchorReviewNotes([note({ line: 5, snippet: 'const x = 1;\r\nmore' })], diff);
    expect(n.line).toBe(5);
    expect(n.stale).toBeUndefined();
  });
});
