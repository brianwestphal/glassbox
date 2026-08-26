/**
 * Re-anchor AI-authored review notes against the current diff (docs/20 §20.3,
 * P3). A note records the text it was authored against (`snippet`); as the tree
 * moves on, its stored line may no longer point at that text. At load time we
 * re-match each note the same way the human-annotation stale machinery does
 * (`src/review-update.ts`): match the authored text by content near the stored
 * line.
 *
 * - Still aligned → unchanged.
 * - Authored text found at a different (nearby) line → re-anchored there.
 * - The note's line is shown in the diff but its text is gone → flagged `stale`
 *   (rendered, but marked possibly-outdated for the reviewer).
 * - The note's line isn't in the diff, or it has no snippet → left untouched
 *   (we can't judge it from the diff alone, and it won't render anyway).
 */
import type { FileDiff } from '../git/diff.js';
import type { ReviewNoteView } from './view.js';

const MATCH_RADIUS = 50;

// The stored snippet is LF-authored, but a file checked out on Windows (no
// `.gitattributes` forcing LF) yields CRLF content — so a revealed line reads as
// `"code\r"` and would never string-equal the `"code"` anchor, silently marking
// every note stale on Windows (GB-1139 reveal path + inline anchoring). Compare
// with the trailing carriage return stripped from both sides.
const stripCr = (s: string): string => s.replace(/\r$/, '');

export function reanchorReviewNotes(notes: ReviewNoteView[], diff: FileDiff): ReviewNoteView[] {
  // Current new-side content, by line number.
  const byLine = new Map<number, string>();
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.newNum !== null) byLine.set(line.newNum, stripCr(line.content));
    }
  }

  return notes.map((note) => {
    if (note.snippet === undefined || note.snippet === '') return note;
    const anchor = stripCr(note.snippet.split('\n')[0]);

    const current = byLine.get(note.line);
    if (current === anchor) return note; // still aligned

    // Find the nearest line whose content matches the authored anchor.
    let best: number | null = null;
    let bestDistance = Infinity;
    for (const [lineNum, content] of byLine) {
      if (content !== anchor) continue;
      const distance = Math.abs(lineNum - note.line);
      if (distance < bestDistance && distance <= MATCH_RADIUS) {
        bestDistance = distance;
        best = lineNum;
      }
    }
    if (best !== null) return { ...note, line: best, stale: false };

    // No match. If the note's line is shown in the diff, its text genuinely
    // changed → stale. Otherwise we can't tell from the diff → leave as-is.
    if (current !== undefined) return { ...note, stale: true };
    return note;
  });
}
