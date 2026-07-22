/**
 * Share prompt and share action.
 * Tracks cumulative open time, shows a prompt after 5 min total + 1 min session,
 * and provides a share button in the toolbar.
 */
import { delegate } from 'kerfjs';

import { dismissSharePrompt, getSharePromptState } from '../api/index.js';
import { IconHeart, IconX } from '../icons.js';
import { toElement } from './dom.js';
import { openExternalUrl } from './tauri.js';
import { showToast } from './toast.js';

const SHARE_URL = 'https://www.npmjs.com/package/glassbox';
const SPONSOR_URL = 'https://github.com/sponsors/brianwestphal';
const SESSION_THRESHOLD_MS = 60_000;    // 1 minute in current session
const TOTAL_THRESHOLD_MS = 300_000;     // 5 minutes cumulative
const DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TICK_INTERVAL_MS = 15_000;        // check every 15 seconds

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
      // User canceled or share failed — fall through to clipboard
    }
  }
  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(SHARE_URL);
    showToast('Link copied to clipboard!');
  } catch {
    // Last resort: open in new tab
    window.open(SHARE_URL, '_blank');
  }
}

/** Record a dismiss (share or no thanks) — suppresses prompt for 30 days. */
function dismissPrompt(): void {
  void dismissSharePrompt();
}

/**
 * Show the share section once the trigger thresholds are met (see
 * {@link initSharePrompt}). Renders the "Love Glassbox?" Share + Sponsor
 * section into the `#sidebar-share` container near the sidebar footer.
 *
 * This is the single share banner: it is time-gated (so it never nags on first
 * launch) and carries the Sponsor link. The permanent always-available share
 * entry lives in Settings → General.
 */
function showPrompt() {
  if (prompted) return;
  const container = document.getElementById('sidebar-share');
  if (container === null) return;
  prompted = true;

  const section = toElement(
    <div className="sidebar-share-section">
      <button className="sidebar-share-dismiss" id="share-dismiss-btn" title="Dismiss"><IconX /></button>
      <p className="sidebar-share-label">Love Glassbox?</p>
      <div className="sidebar-share-actions">
        <button className="btn btn-share" id="share-glassbox-btn">Share</button>
        <a className="btn btn-sponsor" id="sponsor-glassbox-btn" href={SPONSOR_URL} target="_blank" rel="noopener noreferrer"><IconHeart />Sponsor</a>
      </div>
    </div>
  );

  // Sharing or dismissing silences the prompt for 30 days (FR-16.2).
  void delegate(section, 'click', '#share-glassbox-btn', () => {
    void triggerShare();
    section.remove();
    dismissPrompt();
  });
  // In the Tauri desktop shell `target="_blank"` reaches no real browser, so
  // route the Sponsor link through the OS default browser; a no-op in a plain
  // browser, where the anchor opens normally.
  void delegate(section, 'click', '#sponsor-glassbox-btn', (e) => {
    if (openExternalUrl(SPONSOR_URL)) e.preventDefault();
  });
  void delegate(section, 'click', '#share-dismiss-btn', () => {
    section.remove();
    dismissPrompt();
  });

  container.appendChild(section);
}

/** Initialize share prompt tracking. Call once on app init. */
export function initSharePrompt(isDemoMode: boolean) {
  // Test seam: `?__forceSharePrompt=1` renders the section immediately,
  // bypassing both the demo-mode suppression and the time gate, so the
  // Sponsor-link e2e (GB-808) can exercise the click wiring without waiting out
  // the 5-minute threshold. Harmless in production — it only shows the banner.
  if (new URLSearchParams(window.location.search).has('__forceSharePrompt')) {
    showPrompt();
    return;
  }

  if (isDemoMode) return;

  sessionStartMs = Date.now();

  // Periodically check if we should show the prompt
  const timer = setInterval(() => {
    void checkAndPrompt(timer);
  }, TICK_INTERVAL_MS);
}

async function checkAndPrompt(timer: ReturnType<typeof setInterval>): Promise<void> {
  try {
    const state = await getSharePromptState();

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
