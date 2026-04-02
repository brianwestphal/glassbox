/**
 * In-page find bar for diff content.
 * Triggered by Cmd/Ctrl+F. Searches visible text in the diff container,
 * highlights matches, and allows navigation between them.
 */
import { toElement } from '../dom.js';

let findBar: HTMLElement | null = null;
let findInput: HTMLInputElement | null = null;
let currentQuery = '';
let matches: Range[] = [];
let currentMatch = -1;
let matchLabel: HTMLElement | null = null;

const HIGHLIGHT_CLASS = 'find-highlight';
const ACTIVE_HIGHLIGHT_CLASS = 'find-highlight-active';

export function bindFind() {
  // Only activate in Tauri — browsers have their own find
  const isTauri = (window as Record<string, unknown>).__TAURI__ !== undefined;
  if (!isTauri) return;

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
  const tauriObj = (window as Record<string, unknown>).__TAURI__ as
    | { event?: { listen: (name: string, cb: () => void) => void } }
    | undefined;
  tauriObj?.event?.listen('menu-find', () => {
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
  matches = [];
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

  findInput = findBar.querySelector('.find-input') as HTMLInputElement;
  matchLabel = findBar.querySelector('.find-match-count') as HTMLElement;

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

function runSearch(query: string) {
  clearHighlights();
  matches = [];
  currentMatch = -1;
  currentQuery = query;

  if (!query || query.length < 2) {
    updateLabel();
    return;
  }

  const container = document.getElementById('diff-container');
  if (!container) return;

  const lowerQuery = query.toLowerCase();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent;
    const lowerText = text.toLowerCase();
    let idx = 0;
    while ((idx = lowerText.indexOf(lowerQuery, idx)) !== -1) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + query.length);
      matches.push(range);
      idx += query.length;
    }
  }

  // Apply highlights using CSS custom highlight API if available, otherwise wrap in spans
  for (const range of matches) {
    highlightRange(range);
  }

  if (matches.length > 0) {
    currentMatch = 0;
    activateMatch(0);
  }

  updateLabel();
}

function highlightRange(range: Range) {
  try {
    const span = document.createElement('mark');
    span.className = HIGHLIGHT_CLASS;
    range.surroundContents(span);
  } catch {
    // surroundContents fails if range crosses element boundaries — skip
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

function activateMatch(index: number) {
  // Remove previous active
  document.querySelectorAll(`.${ACTIVE_HIGHLIGHT_CLASS}`).forEach(el => { el.classList.remove(ACTIVE_HIGHLIGHT_CLASS); });

  const allMarks = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  if (index >= 0 && index < allMarks.length) {
    allMarks[index].classList.add(ACTIVE_HIGHLIGHT_CLASS);
    allMarks[index].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function goToMatch(direction: number) {
  const allMarks = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  if (allMarks.length === 0) return;

  currentMatch += direction;
  if (currentMatch >= allMarks.length) currentMatch = 0;
  if (currentMatch < 0) currentMatch = allMarks.length - 1;

  activateMatch(currentMatch);
  updateLabel();
}

function updateLabel() {
  if (!matchLabel) return;
  const allMarks = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  if (!currentQuery || currentQuery.length < 2) {
    matchLabel.textContent = '';
  } else if (allMarks.length === 0) {
    matchLabel.textContent = 'No matches';
  } else {
    matchLabel.textContent = `${currentMatch + 1} of ${allMarks.length}`;
  }
}
