import { asButton } from '../dom.js';
/**
 * Navigation stack for tracking file/scroll position history.
 * Supports back/forward navigation like a browser.
 */

export interface NavEntry {
  /** Review file ID (null for raw repo files opened via go-to-definition) */
  fileId: string | null;
  /** File path (used for raw files) */
  filePath: string | null;
  /** First visible line number (updated on scroll) */
  scrollLine: number;
}

const stack: NavEntry[] = [];
let cursor = -1; // Index of the current entry
let navigating = false; // True when back/forward navigation is in progress

/** Push a new entry. Clears the forward stack unless we're navigating. */
export function navPush(entry: NavEntry) {
  if (navigating) return;
  // If the current entry is the same file, just update scroll position
  if (cursor >= 0 && isSameFile(stack[cursor], entry)) {
    stack[cursor].scrollLine = entry.scrollLine;
    updateButtons();
    return;
  }
  // Clear forward stack
  stack.length = cursor + 1;
  stack.push({ ...entry });
  cursor = stack.length - 1;
  updateButtons();
}

/** Update the scroll position of the current entry without pushing. */
export function navUpdateScroll(scrollLine: number) {
  if (cursor >= 0) {
    stack[cursor].scrollLine = scrollLine;
  }
}

/** Go back in the stack. Returns the entry to navigate to, or null. */
export function navBack(): NavEntry | null {
  if (cursor <= 0) return null;
  cursor--;
  updateButtons();
  return { ...stack[cursor] };
}

/** Go forward in the stack. Returns the entry to navigate to, or null. */
export function navForward(): NavEntry | null {
  if (cursor >= stack.length - 1) return null;
  cursor++;
  updateButtons();
  return { ...stack[cursor] };
}

export function canGoBack(): boolean { return cursor > 0; }
export function canGoForward(): boolean { return cursor < stack.length - 1; }

/** Set the navigating flag to prevent navPush during back/forward. */
export function setNavigating(v: boolean) { navigating = v; }

function isSameFile(a: NavEntry, b: NavEntry): boolean {
  if (a.fileId !== null && b.fileId !== null) return a.fileId === b.fileId;
  if (a.filePath !== null && b.filePath !== null) return a.filePath === b.filePath;
  return false;
}

/** Update the disabled state of the back/forward buttons. */
function updateButtons() {
  const backBtn = document.getElementById('nav-back-btn');
  const fwdBtn = document.getElementById('nav-forward-btn');
  if (backBtn) {
    backBtn.classList.toggle('disabled', !canGoBack());
    asButton(backBtn).disabled = !canGoBack();
  }
  if (fwdBtn) {
    fwdBtn.classList.toggle('disabled', !canGoForward());
    asButton(fwdBtn).disabled = !canGoForward();
  }
}

/** Get the first visible line number in the diff container. */
export function getVisibleScrollLine(): number {
  const container = document.getElementById('diff-container');
  if (!container) return 1;
  const rect = container.getBoundingClientRect();
  // Find the first .diff-line that's visible in the scroll container
  const lines = container.querySelectorAll<HTMLElement>('.diff-line[data-line]');
  for (const line of lines) {
    const lineRect = line.getBoundingClientRect();
    if (lineRect.top >= rect.top - 5) {
      return parseInt(line.dataset.line ?? '1', 10);
    }
  }
  return 1;
}
