/**
 * Pure label helpers for the sidebar file context menu (doc 21). Kept in their
 * own DOM-free module so they can be unit-tested without importing the menu's
 * store/DOM dependencies (`stores/index.ts` dereferences `document` at load).
 */

/**
 * Platform-appropriate label for the "reveal this file in the OS file manager"
 * action. The server's `openOS(path, 'reveal')` opens Finder with the file
 * selected on macOS, File Explorer with the file selected on Windows, and the
 * containing folder (no widely-supported select) on Linux — so the label
 * matches what the user will actually see.
 */
export function revealLabel(userAgent: string = navigator.userAgent): string {
  if (userAgent.includes('Mac')) return 'Reveal in Finder';
  if (userAgent.includes('Win')) return 'Reveal in File Explorer';
  return 'Open Containing Folder';
}

/** Copy-path label. Default copies the absolute path; holding Option/Alt copies
 *  the repo-relative path (the live label and the click behavior both key off
 *  the modifier). */
export function copyPathLabel(altHeld: boolean): string {
  return altHeld ? 'Copy Relative Path' : 'Copy Absolute Path';
}

/** Toggle label for the mark-reviewed/pending action, based on current status. */
export function markStatusLabel(status: string | undefined): string {
  return status === 'reviewed' ? 'Mark as Pending' : 'Mark as Reviewed';
}
