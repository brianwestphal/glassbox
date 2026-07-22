import { toElement } from './dom.js';
import { TOAST_DURATION_MS } from './timing.js';

/**
 * Show a transient toast message (auto-dismisses after `TOAST_DURATION_MS`).
 * The single toast implementation (GB-1087) — go-to-definition feedback,
 * plugin UI-element actions (doc 30 FR-30.5), the share copy confirmation, and
 * the settings error flash all route through here. Replaces any existing toast
 * with the same class in the container so messages don't stack.
 *
 * `container` defaults to `document.body` (bottom app toast); the settings
 * dialog passes its overlay so the flash sits over the dialog and survives the
 * mounted body's re-renders. `className` picks the SCSS skin.
 */
export function showToast(
  message: string,
  opts: { container?: HTMLElement; className?: string } = {},
): void {
  const className = opts.className ?? 'app-toast';
  const container = opts.container ?? document.body;
  container.querySelector(`.${className}`)?.remove();
  const toast = toElement(<div className={className}>{message}</div>);
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); }, TOAST_DURATION_MS);
}
