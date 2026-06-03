/**
 * In-process state for an accumulating `git difftool` session (doc 19).
 *
 * A detached server (`glassbox --difftool-serve`, started by the
 * `glassbox-difftool` wrapper) hosts exactly one live review that grows as the
 * wrapper appends files. This module owns that session's lifetime:
 *
 *  - **Holds** — the last-file wrapper holds an HTTP connection open
 *    (`GET /api/difftool/hold`) so `git difftool` stays attached to the
 *    terminal. {@link addDifftoolHold} registers the held response; ending the
 *    session resolves every hold so the wrapper exits `0` (FR-19.5).
 *  - **Teardown** — {@link endDifftoolSession} (triggered by the "Done" button,
 *    a closed browser tab, or a dropped hold connection on Ctrl-C) resolves the
 *    holds and runs the injected `shutdown` so the detached server exits and
 *    nothing is orphaned (FR-19.5, FR-19.8).
 *  - **Idle backstop** — a generous idle timer is the last resort only; the
 *    held connection + end signals are the primary lifecycle (FR-19.5).
 *
 * `shutdown` is injected (rather than calling `process.exit` directly) so the
 * route and lifecycle logic can be exercised in tests without killing the test
 * runner.
 */

/** Last-resort idle backstop. The held connection and end signals are the real
 *  lifecycle, so this should rarely fire; kept generous on purpose (doc 19 open
 *  question — tuned conservatively). */
export const DIFFTOOL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

interface DifftoolSessionState {
  reviewId: string;
  repoRoot: string;
  holds: Set<() => void>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  idleMs: number;
  shutdown: () => void;
  ended: boolean;
}

let session: DifftoolSessionState | null = null;

export function initDifftoolSession(opts: {
  reviewId: string;
  repoRoot: string;
  shutdown: () => void;
  idleMs?: number;
}): void {
  session = {
    reviewId: opts.reviewId,
    repoRoot: opts.repoRoot,
    holds: new Set(),
    idleTimer: null,
    idleMs: opts.idleMs ?? DIFFTOOL_IDLE_TIMEOUT_MS,
    shutdown: opts.shutdown,
    ended: false,
  };
  resetIdleTimer();
}

/** The active session's review/repo, or `null` when this server isn't hosting a
 *  difftool session (the normal case for an ordinary `glassbox` run). */
export function getDifftoolSession(): { reviewId: string; repoRoot: string } | null {
  if (session === null || session.ended) return null;
  return { reviewId: session.reviewId, repoRoot: session.repoRoot };
}

/** Keep the session alive: reset the idle backstop on any session activity
 *  (append, poll, ping, hold). */
export function noteDifftoolActivity(): void {
  if (session === null || session.ended) return;
  resetIdleTimer();
}

function resetIdleTimer(): void {
  if (session === null) return;
  if (session.idleTimer !== null) clearTimeout(session.idleTimer);
  const timer = setTimeout(() => { endDifftoolSession(); }, session.idleMs);
  // The Hono server keeps the event loop alive; the backstop must not do so on
  // its own, or a torn-down session could linger purely on this timer.
  timer.unref();
  session.idleTimer = timer;
}

/**
 * Register a held connection (the last-file wrapper). `release` is called when
 * the session ends, completing the held HTTP response so the wrapper — and
 * `git difftool` — returns cleanly. If the session is already gone, `release`
 * fires immediately so the caller never blocks forever.
 */
export function addDifftoolHold(release: () => void): void {
  if (session === null || session.ended) { release(); return; }
  session.holds.add(release);
  resetIdleTimer();
}

/**
 * End the session: resolve every held connection, then run the injected
 * shutdown after a short flush window so the held HTTP responses reach the
 * wrapper before the process exits. Idempotent.
 */
export function endDifftoolSession(): void {
  if (session === null || session.ended) return;
  session.ended = true;
  if (session.idleTimer !== null) { clearTimeout(session.idleTimer); session.idleTimer = null; }
  for (const release of session.holds) {
    try { release(); } catch { /* a hold whose socket already dropped — ignore */ }
  }
  session.holds.clear();
  const shutdown = session.shutdown;
  // Let the resolved hold responses flush over loopback before tearing down.
  setTimeout(() => { shutdown(); }, 150);
}

/** Test-only: drop any active session so each test starts clean. */
export function resetDifftoolSessionForTest(): void {
  if (session?.idleTimer != null) clearTimeout(session.idleTimer);
  session = null;
}
