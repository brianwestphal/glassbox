/**
 * Share prompt and share action.
 * Tracks cumulative open time, shows a prompt after 5 min total + 1 min session,
 * and provides a share button in the toolbar.
 */
import { api } from './api.js';
import { toElement } from './dom.js';

const SHARE_URL = 'https://www.npmjs.com/package/glassbox';
const SESSION_THRESHOLD_MS = 60_000;    // 1 minute in current session
const TOTAL_THRESHOLD_MS = 300_000;     // 5 minutes cumulative
const DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TICK_INTERVAL_MS = 15_000;        // check every 15 seconds

interface ShareState {
  dismissedAt: number | null;
  totalOpenMs: number;
}

let sessionStartMs = Date.now();
let prompted = false;

/** Trigger the OS share sheet or fallback to clipboard copy. */
export async function triggerShare(): Promise<void> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: 'Glassbox',
        text: 'A local code review tool for AI-generated code.',
        url: SHARE_URL,
      });
      return;
    } catch {
      // User cancelled or share failed — fall through to clipboard
    }
  }
  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(SHARE_URL);
    showCopyToast();
  } catch {
    // Last resort: open in new tab
    window.open(SHARE_URL, '_blank');
  }
}

function showCopyToast() {
  const existing = document.querySelector('.share-toast');
  if (existing) existing.remove();
  const toast = toElement(<div className="share-toast">Link copied to clipboard!</div>);
  document.body.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 2000);
}

/** Record a dismiss (share or no thanks) — suppresses prompt for 30 days. */
function dismissPrompt(): void {
  void api('/share-prompt/dismiss', { method: 'POST' });
}

/** Show the share prompt banner. */
function showPrompt() {
  if (prompted) return;
  prompted = true;

  const banner = toElement(
    <div className="share-prompt">
      <span className="share-prompt-text">Enjoying Glassbox? Share it with others!</span>
      <button className="btn btn-xs btn-primary share-prompt-share">Share</button>
      <button className="btn btn-xs share-prompt-dismiss">No thanks</button>
    </div>
  );

  banner.querySelector('.share-prompt-share')?.addEventListener('click', () => {
    void triggerShare();
    banner.remove();
    dismissPrompt();
  });

  banner.querySelector('.share-prompt-dismiss')?.addEventListener('click', () => {
    banner.remove();
    dismissPrompt();
  });

  // Insert at top of sidebar, after the header
  const sidebar = document.querySelector('.sidebar');
  const header = document.querySelector('.sidebar-header');
  if (sidebar && header) {
    header.after(banner);
  }
}

/** Initialize share prompt tracking. Call once on app init. */
export function initSharePrompt(isDemoMode: boolean) {
  if (isDemoMode) return;

  sessionStartMs = Date.now();

  // Periodically check if we should show the prompt
  const timer = setInterval(() => {
    void checkAndPrompt(timer);
  }, TICK_INTERVAL_MS);
}

async function checkAndPrompt(timer: ReturnType<typeof setInterval>): Promise<void> {
  try {
    const state = await api<ShareState>('/share-prompt/state');

    // Already dismissed within cooldown?
    if (state.dismissedAt !== null) {
      const elapsed = Date.now() - state.dismissedAt;
      if (elapsed < DISMISS_COOLDOWN_MS) {
        clearInterval(timer);
        return;
      }
    }

    // Check thresholds
    const sessionMs = Date.now() - sessionStartMs;
    const totalMs = state.totalOpenMs + sessionMs;

    if (totalMs >= TOTAL_THRESHOLD_MS && sessionMs >= SESSION_THRESHOLD_MS) {
      clearInterval(timer);
      showPrompt();
    }
  } catch {
    // API not available — skip
  }
}
