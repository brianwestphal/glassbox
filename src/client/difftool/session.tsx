/**
 * Client side of an accumulating `git difftool` session (doc 19, FR-19.8 /
 * 19.5). Active only when the page was served for a difftool review
 * (`document.body.dataset.difftool === '1'`).
 *
 * Three responsibilities:
 *  - **Live file list** — poll the server so files appended by the wrapper after
 *    the page loaded show up in the sidebar without a manual reload. The sidebar
 *    is already reactive over `reviewStore`, so updating the store grows the
 *    list; the first file to arrive is auto-selected.
 *  - **"Done"** — end the session, releasing the held wrapper so `git difftool`
 *    returns cleanly (no Ctrl-C). A difftool session is transient, so this does
 *    NOT run the normal review-completion/export flow.
 *  - **Tab close** — signal end-of-session via `sendBeacon` so the detached
 *    server tears down (the browser-mode equivalent of closing the window).
 */
import { delegate } from 'kerfjs';
import { overlay } from 'kerfjs/overlay';

import { endDifftool, pollDifftool } from '../../api/index.js';
import { selectFile } from '../diff/selection.js';
import { reviewStore, visibleFileOrder } from '../stores/index.js';
import { DIFFTOOL_SESSION_POLL_MS } from '../timing.js';


let pollTimer: ReturnType<typeof setInterval> | null = null;
let sessionEnded = false;

export function initDifftoolSession(): void {
  if (document.body.dataset.difftool !== '1') return;
  bindDoneButton();
  bindTabClose();
  startPolling();
}

function bindDoneButton(): void {
  const root = document.querySelector<HTMLElement>('.review-app') ?? document.body;
  void delegate(root, 'click', '#difftool-done', () => {
    void endSession();
  });
}

function bindTabClose(): void {
  // Closing the tab ends the session server-side. `sendBeacon` survives unload
  // where a normal fetch would be canceled. The endpoint ignores the body.
  window.addEventListener('beforeunload', () => {
    if (sessionEnded) return;
    const reviewId = reviewStore.state.value.reviewId;
    navigator.sendBeacon('/api/difftool/end?reviewId=' + encodeURIComponent(reviewId));
  });
}

function startPolling(): void {
  pollTimer = setInterval(() => { void pollOnce(); }, DIFFTOOL_SESSION_POLL_MS);
  // Run one immediately so a file appended before the page finished loading
  // appears without waiting a full interval.
  void pollOnce();
}

async function pollOnce(): Promise<void> {
  if (sessionEnded) return;
  try {
    const resp = await pollDifftool();
    if (!resp.active) { onSessionEnded(); return; }
    reviewStore.actions.update({
      files: resp.files,
      annotationCounts: resp.annotationCounts,
      staleCounts: resp.staleCounts,
    });
    // Auto-select the first file once any have arrived and nothing is selected.
    if (reviewStore.state.value.currentFileId === null) {
      const order = visibleFileOrder.value;
      if (order.length > 0) void selectFile(order[0]);
    }
  } catch {
    // The server closes its socket as it tears down — a failed poll is the
    // end-of-session signal in that case.
    onSessionEnded();
  }
}

async function endSession(): Promise<void> {
  if (sessionEnded) return;
  try { await endDifftool(); } catch { /* server may already be tearing down */ }
  onSessionEnded();
}

function onSessionEnded(): void {
  if (sessionEnded) return;
  sessionEnded = true;
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
  showEndedOverlay();
}

function showEndedOverlay(): void {
  if (document.getElementById('difftool-ended-overlay') !== null) return;
  // Terminal info overlay via kerfjs/overlay (native <dialog>): no dismiss —
  // the session is over, the only action is to close the tab. `onSessionEnded`
  // already guarantees this runs once (the `sessionEnded` guard), and the
  // getElementById check above is belt-and-braces. The id lives on the inner
  // `.modal` so it stays queryable.
  overlay(
    () => (
      <div className="modal" id="difftool-ended-overlay">
        <h3>Review session ended</h3>
        <p>The <code>git difftool</code> session is complete. You can close this tab.</p>
      </div>
    ),
    { className: 'modal-overlay', native: true },
  );
}
