import { toElement } from './dom.js';

/**
 * Show a transient bottom toast message (auto-dismisses ~2s). Shared by
 * go-to-definition feedback and plugin UI-element actions (doc 30 FR-30.5).
 * Replaces any existing toast so messages don't stack.
 */
export function showToast(message: string): void {
  const existing = document.querySelector('.app-toast');
  if (existing) existing.remove();
  const toast = toElement(<div className="app-toast">{message}</div>);
  document.body.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 2000);
}
