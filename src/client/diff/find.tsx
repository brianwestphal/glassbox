/**
 * In-page find bar for diff content.
 * Triggered by Cmd/Ctrl+F. Searches visible text in the diff container,
 * highlights matches, and allows navigation between them.
 */
import { toElement } from '../dom.js';
import { getTauriGlobal } from '../tauri.js';

let findBar: HTMLElement | null = null;
let findInput: HTMLInputElement | null = null;
let currentQuery = '';
let matchCount = 0;
let currentMatch = -1;
let matchLabel: HTMLElement | null = null;

const HIGHLIGHT_CLASS = 'find-highlight';
const ACTIVE_HIGHLIGHT_CLASS = 'find-highlight-active';
const MATCH_INDEX_ATTR = 'data-match-index';

export function bindFind() {
  // Only activate in Tauri — browsers have their own find
  const tauri = getTauriGlobal();
  if (tauri === undefined) return;

  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl+F: open find bar
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      showFindBar();
      return;
    }
    // Escape: close find bar
    if (e.key === 'Escape' && findBar?.style.display !== 'none') {
      hideFindBar();
      return;
    }
    // Find next/previous — OS-standard shortcuts
    // macOS: Cmd+G / Shift+Cmd+G
    // Windows/Linux: F3 / Shift+F3
    if (findBar?.style.display !== 'none') {
      if ((e.metaKey && e.key === 'g') || e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) goToMatch(-1);
        else goToMatch(1);
      }
    }
  });

  // Listen for Tauri menu event (Edit > Find)
  tauri.event?.listen('menu-find', () => {
    showFindBar();
  });
}

function showFindBar() {
  if (findBar === null) createFindBar();
  if (findBar !== null) findBar.style.display = 'flex';
  if (findInput !== null) {
    findInput.focus();
    findInput.select();
  }
}

function hideFindBar() {
  if (findBar) findBar.style.display = 'none';
  clearHighlights();
  currentQuery = '';
  matchCount = 0;
  currentMatch = -1;
}

function createFindBar() {
  const isMac = navigator.userAgent.includes('Mac');
  findBar = toElement(
    <div className="find-bar">
      <input type="text" className="find-input" placeholder="Find in diff..." />
      <span className="find-match-count"></span>
      <button className="find-nav-btn" data-dir="prev"
        title={isMac ? 'Previous (\u21E7\u2318G)' : 'Previous (Shift+F3)'}>{'\u25B2'}</button>
      <button className="find-nav-btn" data-dir="next"
        title={isMac ? 'Next (\u2318G)' : 'Next (F3)'}>{'\u25BC'}</button>
      <button className="find-close-btn" title="Close (Esc)">{'\u00D7'}</button>
    </div>
  );

  findInput = findBar.querySelector<HTMLInputElement>('.find-input');
  matchLabel = findBar.querySelector<HTMLElement>('.find-match-count');
  if (findInput === null) return;

  findInput.addEventListener('input', () => {
    if (findInput !== null) runSearch(findInput.value);
  });

  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) goToMatch(-1);
      else goToMatch(1);
    }
  });

  findBar.querySelector('[data-dir="prev"]')?.addEventListener('click', () => { goToMatch(-1); });
  findBar.querySelector('[data-dir="next"]')?.addEventListener('click', () => { goToMatch(1); });
  findBar.querySelector('.find-close-btn')?.addEventListener('click', () => { hideFindBar(); });

  // Prevent clicks in the find bar from bubbling (e.g. triggering annotation creation)
  findBar.addEventListener('mousedown', (e) => { e.stopPropagation(); });

  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    mainContent.insertBefore(findBar, mainContent.firstChild);
  } else {
    document.body.appendChild(findBar);
  }
}

interface TextSegment {
  node: Text;
  start: number;  // global offset of this node's first char in the concatenated string
  length: number; // text length of this node
}

interface MatchSpan {
  startSeg: number; // index into segments[]
  startOff: number; // offset within segments[startSeg].node
  endSeg: number;
  endOff: number;
}

/** Pure segment shape — the DOM-agnostic subset of `TextSegment`. Exposed so
 *  the indexing math (which is where the cross-element bug lived) is
 *  unit-testable without a DOM environment. */
export interface SegmentInfo { start: number; length: number }

/**
 * Build a flat text index over every text node under `container`, in
 * document order. The concatenated string lets us run a single `indexOf`
 * across what is structurally many `<span>` siblings (syntax-highlighted
 * code), so a search like `raw(` matches even when "raw" lives in
 * `<span class="hljs-title">raw</span>` and `(` is a separate text node
 * right after it.
 */
function buildTextIndex(container: HTMLElement): { text: string; segments: TextSegment[] } {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const segments: TextSegment[] = [];
  const parts: string[] = [];
  let pos = 0;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const content = node.data;
    if (content.length === 0) continue;
    segments.push({ node, start: pos, length: content.length });
    parts.push(content);
    pos += content.length;
  }
  return { text: parts.join(''), segments };
}

/** Find the segment index whose character range covers `offset`. Searches
 *  forward from `hint` (matches advance monotonically through the text).
 *  Exported for unit tests. */
export function segmentForOffset(segments: SegmentInfo[], offset: number, hint: number): number {
  for (let i = hint; i < segments.length; i++) {
    const s = segments[i];
    if (offset >= s.start && offset < s.start + s.length) return i;
  }
  return segments.length - 1;
}

/** Compute every match span across a concatenated-text + segment layout.
 *  This is the pure piece of the find-across-elements fix — the DOM
 *  walker builds `text + segments`, this function says where every match
 *  lives, and the caller wraps the corresponding text-node ranges in
 *  `<mark>` tags. Exported for unit tests. */
export function findMatchSpans(text: string, segments: SegmentInfo[], query: string): MatchSpan[] {
  if (query === '' || segments.length === 0) return [];
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  const spans: MatchSpan[] = [];
  let idx = 0;
  let hint = 0;
  while ((idx = lowerText.indexOf(lowerQuery, idx)) !== -1) {
    const endGlobal = idx + query.length;
    const startSeg = segmentForOffset(segments, idx, hint);
    const endSeg = segmentForOffset(segments, endGlobal - 1, startSeg);
    spans.push({
      startSeg,
      startOff: idx - segments[startSeg].start,
      endSeg,
      endOff: endGlobal - segments[endSeg].start,
    });
    hint = startSeg;
    idx = endGlobal;
  }
  return spans;
}

function runSearch(query: string) {
  clearHighlights();
  matchCount = 0;
  currentMatch = -1;
  currentQuery = query;

  if (!query || query.length < 2) {
    updateLabel();
    return;
  }

  const container = document.getElementById('diff-container');
  if (!container) return;

  const { text, segments } = buildTextIndex(container);
  if (segments.length === 0) {
    updateLabel();
    return;
  }

  const spans = findMatchSpans(text, segments, query);

  // Wrap matches in reverse order so DOM mutation of later matches doesn't
  // shift earlier offsets. Within each match, wrap segment-by-segment from
  // the last involved node back to the first — same reason. All wraps stay
  // within a single text node (after slicing), so `surroundContents` never
  // crosses element boundaries.
  for (let m = spans.length - 1; m >= 0; m--) {
    wrapMatch(spans[m], segments, m);
  }

  matchCount = spans.length;
  if (matchCount > 0) {
    currentMatch = 0;
    activateMatch(0);
  }

  updateLabel();
}

function wrapMatch(span: MatchSpan, segments: TextSegment[], matchIndex: number): void {
  for (let i = span.endSeg; i >= span.startSeg; i--) {
    const seg = segments[i];
    const lo = i === span.startSeg ? span.startOff : 0;
    const hi = i === span.endSeg ? span.endOff : seg.length;
    if (lo >= hi) continue;
    try {
      const sub = document.createRange();
      sub.setStart(seg.node, lo);
      sub.setEnd(seg.node, hi);
      const mark = toElement(<mark className={HIGHLIGHT_CLASS} {...{ [MATCH_INDEX_ATTR]: String(matchIndex) }}></mark>);
      sub.surroundContents(mark);
    } catch {
      // Skip a single segment's wrap; the rest of the match still renders.
      // surroundContents within a single text node should always succeed,
      // so this is a defensive no-op.
    }
  }
}

function clearHighlights() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize(); // merge adjacent text nodes
  });
}

function marksForMatch(index: number): NodeListOf<Element> {
  return document.querySelectorAll(`.${HIGHLIGHT_CLASS}[${MATCH_INDEX_ATTR}="${String(index)}"]`);
}

function activateMatch(index: number) {
  // Remove previous active class from every fragment of the prior match.
  document.querySelectorAll(`.${ACTIVE_HIGHLIGHT_CLASS}`).forEach(el => { el.classList.remove(ACTIVE_HIGHLIGHT_CLASS); });

  const marks = marksForMatch(index);
  if (marks.length === 0) return;
  // A single logical match may be split across multiple `<mark>` siblings
  // (one per text node it crosses). Mark all of them active so styling
  // applies to the whole highlight, and scroll the first into view.
  marks.forEach(el => { el.classList.add(ACTIVE_HIGHLIGHT_CLASS); });
  marks[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function goToMatch(direction: number) {
  if (matchCount === 0) return;

  currentMatch += direction;
  if (currentMatch >= matchCount) currentMatch = 0;
  if (currentMatch < 0) currentMatch = matchCount - 1;

  activateMatch(currentMatch);
  updateLabel();
}

function updateLabel() {
  if (!matchLabel) return;
  if (!currentQuery || currentQuery.length < 2) {
    matchLabel.textContent = '';
  } else if (matchCount === 0) {
    matchLabel.textContent = 'No matches';
  } else {
    matchLabel.textContent = `${currentMatch + 1} of ${matchCount}`;
  }
}
