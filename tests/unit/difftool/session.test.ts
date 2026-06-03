import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addDifftoolHold,
  endDifftoolSession,
  getDifftoolSession,
  initDifftoolSession,
  noteDifftoolActivity,
  resetDifftoolSessionForTest,
} from '../../../src/difftool/session.js';

// doc 19, FR-19.5 — the held connection + end signals are the session
// lifecycle. `shutdown` is injected so we can assert teardown without exiting
// the test runner.

afterEach(() => {
  resetDifftoolSessionForTest();
  vi.useRealTimers();
});

describe('difftool session lifecycle', () => {
  it('exposes the active review and clears it on end', () => {
    const shutdown = vi.fn();
    initDifftoolSession({ reviewId: 'r1', repoRoot: '/repo', shutdown });
    expect(getDifftoolSession()).toEqual({ reviewId: 'r1', repoRoot: '/repo' });

    endDifftoolSession();
    expect(getDifftoolSession()).toBeNull();
  });

  it('resolves every held connection and runs shutdown after a flush', () => {
    vi.useFakeTimers();
    const shutdown = vi.fn();
    initDifftoolSession({ reviewId: 'r1', repoRoot: '/repo', shutdown });

    const releaseA = vi.fn();
    const releaseB = vi.fn();
    addDifftoolHold(releaseA);
    addDifftoolHold(releaseB);

    endDifftoolSession();

    // Holds resolve synchronously so the wrapper exits promptly...
    expect(releaseA).toHaveBeenCalledTimes(1);
    expect(releaseB).toHaveBeenCalledTimes(1);
    // ...and shutdown runs after the brief response-flush delay.
    expect(shutdown).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second end does not run shutdown twice', () => {
    vi.useFakeTimers();
    const shutdown = vi.fn();
    initDifftoolSession({ reviewId: 'r1', repoRoot: '/repo', shutdown });
    endDifftoolSession();
    endDifftoolSession();
    vi.advanceTimersByTime(500);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('fires a hold immediately if registered after the session ended', () => {
    vi.useFakeTimers();
    initDifftoolSession({ reviewId: 'r1', repoRoot: '/repo', shutdown: vi.fn() });
    endDifftoolSession();
    vi.advanceTimersByTime(200);

    const release = vi.fn();
    addDifftoolHold(release);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('tears down on the idle backstop when nothing keeps it alive', () => {
    vi.useFakeTimers();
    const shutdown = vi.fn();
    initDifftoolSession({ reviewId: 'r1', repoRoot: '/repo', shutdown, idleMs: 1000 });

    vi.advanceTimersByTime(900);
    noteDifftoolActivity(); // reset the backstop
    vi.advanceTimersByTime(900);
    expect(shutdown).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200); // 1100ms since last activity → fires
    // endDifftoolSession schedules shutdown after the flush delay.
    vi.advanceTimersByTime(200);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
