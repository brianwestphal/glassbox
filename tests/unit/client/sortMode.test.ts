/**
 * Behavioral / state-transition tests for the sort-mode orchestration
 * (`switchSortMode` / `invalidateAnalysisCache`, GB-1158). Line coverage is
 * structurally blind to which decision branch runs, so these mock the shared
 * `analysisEngine` and assert WHICH of stop/resume/trigger fires across realistic
 * multi-step sequences (running↔switch-away↔switch-back; completed↔toggle-back).
 * A regression in the `hasResults && completed` guard — re-running a full
 * analysis on every toggle-back — would slip past every existing test but fail
 * the "back to a completed mode shows cached results" case here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The stores module reads `document.body.dataset` at import time; vitest runs in
// the node environment (no jsdom), so stub the minimal surface before loading.
vi.stubGlobal('document', { body: { dataset: {} } });

vi.mock('../../../src/client/analysisEngine.js', () => ({
  stopPolling: vi.fn(() => 0),
  resumePolling: vi.fn(),
  triggerAnalysisFor: vi.fn(),
}));
vi.mock('../../../src/api/index.js', () => ({
  saveAIPreferences: vi.fn(() => Promise.resolve()),
  getAnalysis: vi.fn(() => Promise.resolve({ status: 'idle', scores: [] })),
}));

const engine = await import('../../../src/client/analysisEngine.js');
const { switchSortMode, invalidateAnalysisCache } = await import('../../../src/client/sidebar/sortMode.js');
const { aiStore } = await import('../../../src/client/stores/index.js');

const stopPolling = vi.mocked(engine.stopPolling);
const resumePolling = vi.mocked(engine.resumePolling);
const triggerAnalysisFor = vi.mocked(engine.triggerAnalysisFor);

beforeEach(() => {
  aiStore.actions.update({ sortMode: 'folder', riskScores: null, narrativeOrder: null });
  aiStore.actions.setAnalysisState('risk', { status: 'idle' });
  aiStore.actions.setAnalysisState('narrative', { status: 'idle' });
  vi.clearAllMocks();
});

describe('switchSortMode transitions', () => {
  it('switching AWAY from a running risk mode stops its polls and does not trigger/resume', () => {
    aiStore.actions.update({ sortMode: 'risk' });
    aiStore.actions.setAnalysisState('risk', { status: 'running' });

    switchSortMode('folder');

    expect(stopPolling).toHaveBeenCalledWith('risk');
    expect(triggerAnalysisFor).not.toHaveBeenCalled();
    expect(resumePolling).not.toHaveBeenCalled();
  });

  it('switching BACK to a still-running mode resumes polling — it does NOT re-trigger a fresh analysis', () => {
    aiStore.actions.setAnalysisState('risk', { status: 'running' });

    switchSortMode('risk');

    expect(resumePolling).toHaveBeenCalledWith('risk', expect.anything());
    expect(triggerAnalysisFor).not.toHaveBeenCalled();
  });

  it('switching back to a COMPLETED mode with results shows the cache — no trigger, no resume (the load-bearing guard)', () => {
    // risk completed with results, then toggle away and back.
    aiStore.actions.update({ sortMode: 'risk', riskScores: [] }); // [] is non-null -> hasResults
    aiStore.actions.setAnalysisState('risk', { status: 'completed' });
    switchSortMode('folder');
    vi.clearAllMocks();

    switchSortMode('risk');

    expect(triggerAnalysisFor).not.toHaveBeenCalled();
    expect(resumePolling).not.toHaveBeenCalled();
  });

  it('switching to a mode with no results from idle triggers a fresh analysis', () => {
    aiStore.actions.update({ riskScores: null });
    aiStore.actions.setAnalysisState('risk', { status: 'idle' });

    switchSortMode('risk');

    expect(triggerAnalysisFor).toHaveBeenCalledWith('risk', expect.anything(), false);
    expect(resumePolling).not.toHaveBeenCalled();
  });

  it('switching to folder never triggers or resumes analysis', () => {
    aiStore.actions.update({ sortMode: 'narrative' });
    aiStore.actions.setAnalysisState('narrative', { status: 'running' });

    switchSortMode('folder');

    expect(stopPolling).toHaveBeenCalledWith('narrative');
    expect(triggerAnalysisFor).not.toHaveBeenCalled();
    expect(resumePolling).not.toHaveBeenCalled();
  });
});

describe('invalidateAnalysisCache', () => {
  it('clears cached results, stops both polls, and re-triggers only the active mode', () => {
    aiStore.actions.update({ sortMode: 'risk', riskScores: [], narrativeOrder: [] });
    aiStore.actions.setAnalysisState('risk', { status: 'completed' });

    invalidateAnalysisCache();

    expect(aiStore.state.value.riskScores).toBeNull();
    expect(aiStore.state.value.narrativeOrder).toBeNull();
    expect(stopPolling).toHaveBeenCalledWith('risk');
    expect(stopPolling).toHaveBeenCalledWith('narrative');
    // Only the active mode (risk) re-triggers, with invalidateCache=true.
    expect(triggerAnalysisFor).toHaveBeenCalledTimes(1);
    expect(triggerAnalysisFor).toHaveBeenCalledWith('risk', expect.anything(), true);
  });

  it('does not re-trigger when the active sort mode is folder', () => {
    aiStore.actions.update({ sortMode: 'folder', riskScores: [] });

    invalidateAnalysisCache();

    expect(aiStore.state.value.riskScores).toBeNull();
    expect(triggerAnalysisFor).not.toHaveBeenCalled();
  });
});
