/**
 * Behavioral tests for the shared analysis trigger/poll engine (GB-1083),
 * including the GB-1082 resilience paths (a transient status-fetch failure
 * must re-schedule, not strand the mode on "running") and the GB-927
 * server-rejected-start path — previously guarded only by a static source
 * scan, now driven for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/api/index.js', () => ({
  startAnalysis: vi.fn(),
  getAnalysisStatus: vi.fn(),
}));

// The stores module reads `document.body.dataset` at import time and this repo
// runs vitest in the node environment (no jsdom) — stub the minimal surface
// BEFORE the client modules load, then import them dynamically.
vi.stubGlobal('document', { body: { dataset: {} } });

const { getAnalysisStatus, startAnalysis } = await import('../../../src/api/index.js');
const {
  MAX_CONSECUTIVE_POLL_ERRORS,
  resumePolling,
  stopPolling,
  triggerAnalysisFor,
} = await import('../../../src/client/analysisEngine.js');
const { aiStore, getAnalysisModeState } = await import('../../../src/client/stores/index.js');
const { ANALYSIS_POLL_INTERVAL_MS } = await import('../../../src/client/timing.js');

const mockStart = vi.mocked(startAnalysis);
const mockStatus = vi.mocked(getAnalysisStatus);

function resetMode(mode: 'risk' | 'narrative' | 'guided'): void {
  aiStore.actions.setAnalysisState(mode, {
    status: 'idle', error: null, progressCompleted: 0, progressTotal: 0,
  });
  stopPolling(mode);
}

/** Advance one poll interval and let the async tick settle. */
async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(ANALYSIS_POLL_INTERVAL_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetMode('risk');
  resetMode('guided');
  mockStart.mockReset();
  mockStatus.mockReset();
});
afterEach(() => {
  stopPolling('risk');
  stopPolling('guided');
  vi.useRealTimers();
});

describe('analysisEngine (GB-1083 / GB-1082 / GB-927)', () => {
  it('a server-rejected start surfaces as failed, never polls (GB-927)', async () => {
    mockStart.mockResolvedValue({ error: 'No API key configured' });
    triggerAnalysisFor('risk', { loadResults: () => Promise.resolve() });
    await vi.advanceTimersByTimeAsync(0);
    expect(getAnalysisModeState('risk').status).toBe('failed');
    expect(getAnalysisModeState('risk').error).toBeTruthy();
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('runs to completion: running progress → completed, loading partial then final results', async () => {
    mockStart.mockResolvedValue({ started: true } as never);
    mockStatus
      .mockResolvedValueOnce({ status: 'running', progressCompleted: 1, progressTotal: 2 })
      .mockResolvedValueOnce({ status: 'completed' });
    const loads: boolean[] = [];
    triggerAnalysisFor('risk', { loadResults: (partial) => { loads.push(partial); return Promise.resolve(); } });
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(getAnalysisModeState('risk').progressCompleted).toBe(1);
    await tick();
    expect(getAnalysisModeState('risk').status).toBe('completed');
    expect(loads).toEqual([true, false]);
  });

  it('a transient status failure re-schedules and recovers (GB-1082)', async () => {
    mockStart.mockResolvedValue({ started: true } as never);
    mockStatus
      .mockRejectedValueOnce(new Error('socket hiccup'))
      .mockResolvedValueOnce({ status: 'completed' });
    triggerAnalysisFor('risk', { loadResults: () => Promise.resolve() });
    await vi.advanceTimersByTimeAsync(0);
    await tick();               // failing tick — must not strand the mode
    expect(getAnalysisModeState('risk').status).toBe('running');
    await tick();               // recovery tick
    expect(getAnalysisModeState('risk').status).toBe('completed');
  });

  it(`fails the mode after ${String(MAX_CONSECUTIVE_POLL_ERRORS)} consecutive poll errors (GB-1082)`, async () => {
    mockStart.mockResolvedValue({ started: true } as never);
    mockStatus.mockRejectedValue(new Error('server gone'));
    triggerAnalysisFor('risk', { loadResults: () => Promise.resolve() });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < MAX_CONSECUTIVE_POLL_ERRORS; i++) await tick();
    expect(getAnalysisModeState('risk').status).toBe('failed');
    // No further polling after the terminal state.
    const calls = mockStatus.mock.calls.length;
    await tick();
    expect(mockStatus.mock.calls.length).toBe(calls);
  });

  it('a Canceled failure defers to the onCanceled hook (auto-retry path)', async () => {
    mockStart.mockResolvedValue({ started: true } as never);
    mockStatus.mockResolvedValueOnce({ status: 'failed', error: 'Canceled' });
    const onCanceled = vi.fn(() => true);
    triggerAnalysisFor('risk', { loadResults: () => Promise.resolve(), onCanceled });
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(onCanceled).toHaveBeenCalled();
    // The hook claimed the retry, so the engine must not mark failed.
    expect(getAnalysisModeState('risk').status).not.toBe('failed');
  });

  it('stopPolling invalidates an in-flight poll chain (stale generation)', async () => {
    mockStart.mockResolvedValue({ started: true } as never);
    mockStatus.mockResolvedValue({ status: 'running', progressCompleted: 0, progressTotal: 2 });
    triggerAnalysisFor('risk', { loadResults: () => Promise.resolve() });
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    const calls = mockStatus.mock.calls.length;
    stopPolling('risk');
    await tick();
    await tick();
    expect(mockStatus.mock.calls.length).toBe(calls); // no ticks after invalidation
  });

  it('resumePolling picks up an already-running analysis without re-triggering', async () => {
    mockStatus.mockResolvedValueOnce({ status: 'completed' });
    aiStore.actions.setAnalysisState('guided', { status: 'running', progressCompleted: 0, progressTotal: 0 });
    resumePolling('guided', { loadResults: () => Promise.resolve() });
    await tick();
    expect(getAnalysisModeState('guided').status).toBe('completed');
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('a final-results load failure marks the mode failed rather than completed', async () => {
    mockStart.mockResolvedValue({ started: true } as never);
    mockStatus.mockResolvedValueOnce({ status: 'completed' });
    triggerAnalysisFor('risk', { loadResults: () => Promise.reject(new Error('load boom')) });
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(getAnalysisModeState('risk').status).toBe('failed');
  });

  // --- Transition sequences (GB-1088) ---

  it('failed → retrigger → completed: a failure does not poison the next run', async () => {
    // First run: server rejects the start.
    mockStart.mockResolvedValueOnce({ error: 'No API key configured' });
    triggerAnalysisFor('risk', { loadResults: () => Promise.resolve() });
    await vi.advanceTimersByTimeAsync(0);
    expect(getAnalysisModeState('risk').status).toBe('failed');

    // Retrigger: accepted and completes. The stale error must clear.
    mockStart.mockResolvedValueOnce({ started: true } as never);
    mockStatus.mockResolvedValueOnce({ status: 'completed' });
    triggerAnalysisFor('risk', { loadResults: () => Promise.resolve() });
    await vi.advanceTimersByTimeAsync(0);
    expect(getAnalysisModeState('risk').status).toBe('running');
    expect(getAnalysisModeState('risk').error).toBeNull();
    await tick();
    expect(getAnalysisModeState('risk').status).toBe('completed');
  });

  it('poll returning status "none" mid-run exits the running state (GB-927 hang shape)', async () => {
    mockStart.mockResolvedValue({ started: true } as never);
    mockStatus
      .mockResolvedValueOnce({ status: 'running', progressCompleted: 1, progressTotal: 3 })
      // The run vanishes (server restarted / row invalidated elsewhere).
      .mockResolvedValueOnce({ status: 'none' });
    triggerAnalysisFor('risk', { loadResults: () => Promise.resolve() });
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(getAnalysisModeState('risk').status).toBe('running');
    await tick();
    // Previously this fell through every status branch: the chain ended with
    // no re-schedule and the mode sat on "running" forever.
    expect(getAnalysisModeState('risk').status).toBe('failed');
    expect(getAnalysisModeState('risk').error).toBeTruthy();
    // The chain is over — no further polls.
    const calls = mockStatus.mock.calls.length;
    await tick();
    expect(mockStatus.mock.calls.length).toBe(calls);
  });

  it('two modes run concurrently without cross-talk (mode-switch mid-run isolation)', async () => {
    mockStart.mockResolvedValue({ started: true } as never);
    // risk stays running forever; guided completes on its first tick.
    mockStatus.mockImplementation((req: { type: string }) =>
      req.type === 'risk'
        ? Promise.resolve({ status: 'running', progressCompleted: 1, progressTotal: 5 })
        : Promise.resolve({ status: 'completed' }),
    );

    triggerAnalysisFor('risk', { loadResults: () => Promise.resolve() });
    await vi.advanceTimersByTimeAsync(0);
    triggerAnalysisFor('guided', { loadResults: () => Promise.resolve() });
    await vi.advanceTimersByTimeAsync(0);
    await tick();

    expect(getAnalysisModeState('guided').status).toBe('completed');
    expect(getAnalysisModeState('risk').status).toBe('running');

    // Stopping guided's (already finished) polling must not kill risk's chain.
    stopPolling('guided');
    const riskCalls = mockStatus.mock.calls.filter(c => (c[0] as { type: string }).type === 'risk').length;
    await tick();
    const riskCallsAfter = mockStatus.mock.calls.filter(c => (c[0] as { type: string }).type === 'risk').length;
    expect(riskCallsAfter).toBeGreaterThan(riskCalls);
    expect(getAnalysisModeState('risk').status).toBe('running');
    expect(getAnalysisModeState('risk').progressCompleted).toBe(1);
  });
});
