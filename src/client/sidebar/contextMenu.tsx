import { delegate } from 'kerfjs';

import { getFilePath, openFileInEditor, revealFile, setFileStatus } from '../../api/index.js';
import { IconCheck, IconCircle, IconCopy, IconEdit, IconReveal } from '../../icons.js';
import { asEl, toElement } from '../dom.js';
import { reviewStore } from '../stores/index.js';
import { copyPathLabel, markStatusLabel, revealLabel } from './contextMenuLabels.js';

let openMenu: HTMLElement | null = null;
let teardown: (() => void) | null = null;

/** Close the open context menu (if any) and detach its dismiss listeners. */
export function closeContextMenu(): void {
  if (teardown !== null) { teardown(); teardown = null; }
  if (openMenu !== null) { openMenu.remove(); openMenu = null; }
}

/**
 * Register the right-click context menu on sidebar file rows. Called once from
 * `initSidebar()`. Every `.file-item` across folder / risk / narrative modes
 * carries `data-file-id`, so a single delegated handler covers them all.
 */
export function bindFileContextMenu(sidebar: HTMLElement): void {
  void delegate(sidebar, 'contextmenu', '.file-item', (e, el) => {
    const ev = e as MouseEvent;
    const fileId = asEl(el).dataset.fileId;
    if (fileId === undefined || fileId === '') return;
    ev.preventDefault();
    showFileContextMenu(ev, fileId);
  });
}

function showFileContextMenu(openingEvent: MouseEvent, fileId: string): void {
  closeContextMenu();

  const file = reviewStore.state.value.files.find(f => f.id === fileId);
  const isReviewed = file?.status === 'reviewed';
  const altAtOpen = openingEvent.altKey;

  const menu = toElement(
    <div className="context-menu" role="menu">
      <button className="context-menu-item" type="button" role="menuitem" data-action="reveal">
        <IconReveal /><span className="context-menu-label">{revealLabel()}</span>
      </button>
      <button className="context-menu-item" type="button" role="menuitem" data-action="copy-path">
        <IconCopy /><span className="context-menu-label">{copyPathLabel(altAtOpen)}</span>
      </button>
      <div className="context-menu-separator" role="separator"></div>
      <button className="context-menu-item" type="button" role="menuitem" data-action="toggle-status">
        {isReviewed ? <IconCircle /> : <IconCheck />}
        <span className="context-menu-label">{markStatusLabel(file?.status)}</span>
      </button>
      <button className="context-menu-item" type="button" role="menuitem" data-action="open-editor">
        <IconEdit /><span className="context-menu-label">Open in Default Editor</span>
      </button>
    </div>
  );

  void delegate(menu, 'click', '.context-menu-item', (e, btn) => {
    const action = asEl(btn).dataset.action;
    const altHeld = (e as MouseEvent).altKey;
    closeContextMenu();
    if (action === 'reveal') void revealFile({ fileId });
    else if (action === 'copy-path') void copyPath(fileId, altHeld);
    else if (action === 'toggle-status') void toggleStatus(fileId);
    else if (action === 'open-editor') void openFileInEditor({ fileId });
  });

  // Append hidden so we can measure it, then clamp to the viewport so a
  // right-click near the bottom/right edge doesn't open the menu off-screen.
  menu.style.position = 'fixed';
  menu.style.zIndex = '300';
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(openingEvent.clientX, window.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(openingEvent.clientY, window.innerHeight - rect.height - 4));
  menu.style.left = String(left) + 'px';
  menu.style.top = String(top) + 'px';
  menu.style.visibility = 'visible';
  openMenu = menu;

  const copyLabelEl = menu.querySelector('[data-action="copy-path"] .context-menu-label');
  const updateCopyLabel = (alt: boolean): void => {
    if (copyLabelEl !== null) copyLabelEl.textContent = copyPathLabel(alt);
  };

  // Dismiss on any outside interaction. Listeners attach synchronously (no
  // `setTimeout` defer — that races against a fast Escape/click); the opening
  // contextmenu event is ignored by identity as it keeps bubbling up to
  // document, so the menu doesn't immediately close itself.
  const onPointerDown = (ev: MouseEvent): void => {
    if (ev === openingEvent) return;
    if (openMenu !== null && !openMenu.contains(ev.target as Node)) closeContextMenu();
  };
  // Escape closes; Alt (down or up) live-updates the Copy Path label like Finder.
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') { closeContextMenu(); return; }
    if (ev.key === 'Alt') updateCopyLabel(ev.altKey);
  };
  document.addEventListener('mousedown', onPointerDown);
  document.addEventListener('contextmenu', onPointerDown);
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKey);
  window.addEventListener('scroll', closeContextMenu, true);
  window.addEventListener('blur', closeContextMenu);
  teardown = () => {
    document.removeEventListener('mousedown', onPointerDown);
    document.removeEventListener('contextmenu', onPointerDown);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKey);
    window.removeEventListener('scroll', closeContextMenu, true);
    window.removeEventListener('blur', closeContextMenu);
  };
}

/** Copy the file's path to the clipboard — relative (from the store, no fetch)
 *  when Option/Alt was held, otherwise the server-resolved absolute path. */
async function copyPath(fileId: string, relative: boolean): Promise<void> {
  let text: string;
  if (relative) {
    const fromStore = reviewStore.state.value.files.find(f => f.id === fileId)?.file_path ?? '';
    text = fromStore !== '' ? fromStore : (await getFilePath({ fileId })).relativePath;
  } else {
    text = (await getFilePath({ fileId })).absolutePath;
  }
  if (text === '') return;
  try {
    await navigator.clipboard.writeText(text);
  } catch { /* clipboard unavailable (no permission / insecure context) */ }
}

/** Flip the file between reviewed and pending, updating the store so the status
 *  dot + progress bar react. */
async function toggleStatus(fileId: string): Promise<void> {
  const current = reviewStore.state.value.files.find(f => f.id === fileId)?.status;
  const next = current === 'reviewed' ? 'pending' : 'reviewed';
  await setFileStatus({ fileId, status: next });
  reviewStore.actions.setFileStatus(fileId, next);
}
