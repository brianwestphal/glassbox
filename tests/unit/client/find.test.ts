/**
 * GB-797 — find-in-diff couldn't match strings that crossed text-node
 * boundaries. The diff renders syntax-highlighted code as adjacent
 * `<span>`s, so the literal text `raw(` is split into `"raw"` (inside
 * `<span class="hljs-title">`) followed by `"("` (a sibling text node).
 * The old search ran `indexOf` per text node, so it found `raw` but
 * dropped `raw(`. The fix builds a concatenated string across every text
 * node under the diff container, runs `indexOf` once on that flat text,
 * and maps the match offsets back to (segment, offset) pairs so the
 * caller can wrap each spanned segment in a `<mark>`.
 *
 * The DOM-walking + wrap-with-mark steps stay in `find.tsx` (they need a
 * DOM environment we don't have configured here). The piece that
 * regressed — the offset math that decides which segments a match
 * covers — is exposed as `findMatchSpans` / `segmentForOffset` for these
 * tests.
 */
import { findMatchSpans, segmentForOffset, type SegmentInfo } from '../../../src/client/diff/find.js';

function segs(...lens: number[]): { text: string; segments: SegmentInfo[] } {
  // Build a `segments[]` describing N adjacent text nodes of the given
  // lengths, plus a sample concat string. Chars are deterministic per
  // segment ('a','b','c'…) so we can build expected match positions by
  // hand.
  const segments: SegmentInfo[] = [];
  const parts: string[] = [];
  let pos = 0;
  for (let i = 0; i < lens.length; i++) {
    segments.push({ start: pos, length: lens[i] });
    parts.push(String.fromCharCode(97 + i).repeat(lens[i]));
    pos += lens[i];
  }
  return { text: parts.join(''), segments };
}

describe('findMatchSpans (GB-797)', () => {
  it('returns no matches for an empty query', () => {
    const { text, segments } = segs(3, 3);
    expect(findMatchSpans(text, segments, '')).toEqual([]);
  });

  it('returns no matches when nothing matches', () => {
    expect(findMatchSpans('hello', [{ start: 0, length: 5 }], 'xyz')).toEqual([]);
  });

  it('finds a match entirely within one segment', () => {
    // "aaa" + "bbb" → looking for "aa"
    const { text, segments } = segs(3, 3);
    const spans = findMatchSpans(text, segments, 'aa');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ startSeg: 0, startOff: 0, endSeg: 0, endOff: 2 });
  });

  it('finds a match that spans two adjacent segments — the regressed case', () => {
    // "raw" (seg 0, len 3) + "(" (seg 1, len 1) + ")" (seg 2, len 1)
    const segments: SegmentInfo[] = [
      { start: 0, length: 3 },
      { start: 3, length: 1 },
      { start: 4, length: 1 },
    ];
    const text = 'raw()';
    const spans = findMatchSpans(text, segments, 'raw(');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ startSeg: 0, startOff: 0, endSeg: 1, endOff: 1 });
  });

  it('finds a match that spans three adjacent segments', () => {
    // "ab" + "cd" + "ef" → search "bcde"
    const segments: SegmentInfo[] = [
      { start: 0, length: 2 },
      { start: 2, length: 2 },
      { start: 4, length: 2 },
    ];
    const text = 'abcdef';
    const spans = findMatchSpans(text, segments, 'bcde');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ startSeg: 0, startOff: 1, endSeg: 2, endOff: 1 });
  });

  it('finds multiple non-overlapping matches across segments', () => {
    // "raw" + "(" + "foo" + " raw" + "(" + "bar"
    const segments: SegmentInfo[] = [
      { start: 0,  length: 3 },  // "raw"
      { start: 3,  length: 1 },  // "("
      { start: 4,  length: 3 },  // "foo"
      { start: 7,  length: 4 },  // " raw"
      { start: 11, length: 1 },  // "("
      { start: 12, length: 3 },  // "bar"
    ];
    const text = 'raw(foo raw(bar';
    const spans = findMatchSpans(text, segments, 'raw(');
    expect(spans).toHaveLength(2);
    expect(spans[0]).toEqual({ startSeg: 0, startOff: 0, endSeg: 1, endOff: 1 });
    expect(spans[1]).toEqual({ startSeg: 3, startOff: 1, endSeg: 4, endOff: 1 });
  });

  it('is case-insensitive (Cmd+F find in browsers is too)', () => {
    const segments: SegmentInfo[] = [{ start: 0, length: 7 }];
    const spans = findMatchSpans('HelloWorld'.slice(0, 7), segments, 'ELLO');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ startSeg: 0, startOff: 1, endSeg: 0, endOff: 5 });
  });

  it('handles a match that ends exactly at the end of the last segment', () => {
    // "abc" + "def" → match "def" — endOff must be 3, not 0 of a phantom next segment.
    const segments: SegmentInfo[] = [
      { start: 0, length: 3 },
      { start: 3, length: 3 },
    ];
    const spans = findMatchSpans('abcdef', segments, 'def');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ startSeg: 1, startOff: 0, endSeg: 1, endOff: 3 });
  });

  it('handles consecutive matches sharing a boundary character', () => {
    // "aaaa" — looking for "aa" should return overlapping-free matches
    // (after each match, search resumes past its end).
    const segments: SegmentInfo[] = [{ start: 0, length: 4 }];
    const spans = findMatchSpans('aaaa', segments, 'aa');
    expect(spans).toHaveLength(2);
    expect(spans[0]).toEqual({ startSeg: 0, startOff: 0, endSeg: 0, endOff: 2 });
    expect(spans[1]).toEqual({ startSeg: 0, startOff: 2, endSeg: 0, endOff: 4 });
  });
});

describe('segmentForOffset (GB-797)', () => {
  const segments: SegmentInfo[] = [
    { start: 0, length: 3 },
    { start: 3, length: 1 },
    { start: 4, length: 5 },
  ];

  it('returns the index of the segment that contains the offset', () => {
    expect(segmentForOffset(segments, 0, 0)).toBe(0);
    expect(segmentForOffset(segments, 2, 0)).toBe(0);
    expect(segmentForOffset(segments, 3, 0)).toBe(1);
    expect(segmentForOffset(segments, 4, 0)).toBe(2);
    expect(segmentForOffset(segments, 8, 0)).toBe(2);
  });

  it('uses `hint` to start the linear scan (forward-only)', () => {
    // If hint is past the actual segment, we still want a sane answer —
    // the runtime caller never reaches into the past, so falling through
    // to the last index is acceptable.
    expect(segmentForOffset(segments, 2, 2)).toBe(2);
  });
});
