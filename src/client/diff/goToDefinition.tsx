/**
 * Go-to-definition: Cmd+Click (macOS) / Ctrl+Click (Windows/Linux) on a symbol
 * in the diff view navigates to its definition.
 */
import { api } from '../api.js';
import { toElement } from '../dom.js';
import { reviewStore } from '../stores/index.js';
import { JUMP_HIGHLIGHT_DURATION_MS } from '../timing.js';
import { setRawDiffContent } from './index.js';
import { navPush } from './navStack.js';
import { selectFile, updateNavFilePath } from './selection.js';

interface SymbolDef {
  fileId: string | null;
  filePath: string;
  name: string;
  kind: string;
  line: number;
}

export function bindGoToDefinition() {
  const container = document.getElementById('diff-container');
  if (!container) return;

  container.addEventListener('click', (e) => {
    // Cmd+Click (macOS) or Ctrl+Click (Windows/Linux)
    if (!(e.metaKey || e.ctrlKey)) return;
    // Don't interfere with existing click handlers (annotations, buttons, etc.)
    if ((e.target as HTMLElement).closest('button, a, .annotation-row, .annotation-form-container')) return;

    const word = getWordAtPoint(e.clientX, e.clientY);
    if (word === null || word.length < 2) return;

    e.preventDefault();
    e.stopPropagation();
    void navigateToDefinition(word);
  });

  // Show pointer cursor when Cmd/Ctrl is held over identifiers
  container.addEventListener('mousemove', (e) => {
    const code = (e.target as HTMLElement).closest('.code');
    if (code) {
      (code as HTMLElement).style.cursor = (e.metaKey || e.ctrlKey) ? 'pointer' : '';
    }
  });
}

function getWordAtPoint(x: number, y: number): string | null {
  // caretRangeFromPoint (WebKit/Blink) or caretPositionFromPoint (standard)
  let node: Node | null = null;
  let offset = 0;

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- no cross-browser alternative exists
  const range = document.caretRangeFromPoint(x, y);
  if (range !== null) {
    node = range.startContainer;
    offset = range.startOffset;
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? '';
  if (offset >= text.length) return null;

  // Expand to identifier boundaries
  let start = offset, end = offset;
  while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
  while (end < text.length && /[\w$]/.test(text[end])) end++;

  const word = text.slice(start, end);
  // Skip pure numbers and very short words
  if (!word || word.length < 2 || /^\d+$/.test(word)) return null;
  // Skip common keywords
  if (SKIP_WORDS.has(word)) return null;

  return word;
}

const SKIP_WORDS = new Set([
  // JS/TS keywords
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'return', 'throw', 'try', 'catch', 'finally', 'new', 'delete', 'typeof',
  'instanceof', 'void', 'this', 'super', 'class', 'extends', 'implements',
  'interface', 'enum', 'const', 'let', 'var', 'function', 'async', 'await',
  'import', 'export', 'from', 'default', 'true', 'false', 'null', 'undefined',
  'in', 'of', 'as', 'is', 'type', 'declare', 'module', 'namespace',
  // Common types
  'string', 'number', 'boolean', 'object', 'any', 'unknown', 'never',
  'int', 'float', 'double', 'char', 'bool', 'void',
  // Python
  'def', 'self', 'cls', 'None', 'True', 'False', 'and', 'or', 'not',
  'with', 'pass', 'raise', 'yield', 'lambda', 'print',
  // Go
  'func', 'package', 'defer', 'go', 'chan', 'select', 'range',
  'map', 'make', 'append', 'len', 'cap', 'nil', 'err',
  // Rust
  'fn', 'let', 'mut', 'pub', 'use', 'mod', 'impl', 'trait', 'where',
  'match', 'Some', 'None', 'Ok', 'Err', 'Self',
]);

async function navigateToDefinition(symbolName: string) {
  const currentFileId = reviewStore.state.value.currentFileId ?? '';
  const data = await api<{ definitions: SymbolDef[] }>(
    `/symbol-definition?name=${encodeURIComponent(symbolName)}&currentFileId=${encodeURIComponent(currentFileId)}`
  );

  if (data.definitions.length === 0) {
    showToast(`No definition found for "${symbolName}"`);
    return;
  }

  const def = data.definitions[0];

  if (def.fileId !== null && def.fileId === currentFileId) {
    // Same file — scroll to the definition line
    scrollToLine(def.line);
  } else if (def.fileId !== null) {
    // Different file in the review — switch to it and scroll after load
    await selectFile(def.fileId);
    requestAnimationFrame(() => { scrollToLine(def.line); });
  } else {
    // File not in the review — load it as a read-only view
    await loadRawFile(def.filePath, def.line);
  }
}

async function loadRawFile(filePath: string, targetLine: number) {
  const res = await fetch('/file-raw?path=' + encodeURIComponent(filePath));
  if (!res.ok) {
    showToast(`Could not open ${filePath}`);
    return;
  }

  // Clear sidebar selection (this file isn't in the sidebar) and route the
  // raw HTML through the diff mount's signal — `setRawDiffContent()` handles
  // toolbar visibility + syntax highlighting via the post-render effect.
  document.querySelectorAll('.file-item.active').forEach(el => { el.classList.remove('active'); });
  reviewStore.actions.update({ currentFileId: null });
  setRawDiffContent(filePath, await res.text());

  updateNavFilePath(filePath);
  navPush({ fileId: null, filePath, scrollLine: targetLine });

  // Scroll to the target line (wait a frame for the mount + post-render to flush).
  requestAnimationFrame(() => { scrollToLine(targetLine); });
}

function showToast(message: string) {
  const existing = document.querySelector('.goto-toast');
  if (existing) existing.remove();
  const toast = toElement(<div className="goto-toast">{message}</div>);
  document.body.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 2000);
}

function scrollToLine(lineNumber: number) {
  // Find the diff line with this line number on the new side
  const lineEl = document.querySelector(
    `.diff-line[data-line="${lineNumber}"][data-side="new"]`
  );

  if (lineEl) {
    lineEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Brief highlight to show where we jumped to
    lineEl.classList.add('jump-highlight');
    setTimeout(() => { lineEl.classList.remove('jump-highlight'); }, JUMP_HIGHLIGHT_DURATION_MS);
  }
}
