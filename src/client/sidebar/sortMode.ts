/**
 * Risk / narrative sort-mode orchestration: mode switching, cache
 * invalidation, and result loading. The trigger/poll machinery itself lives in
 * the shared `analysisEngine` (GB-1083) — this module supplies the per-mode
 * hooks (result loading into `aiStore`, the canceled-run auto-retry).
 */
import { getAnalysis, saveAIPreferences } from '../../api/index.js';
import type { AnalysisHooks } from '../analysisEngine.js';
import { resumePolling, stopPolling, triggerAnalysisFor } from '../analysisEngine.js';
import { clientLog } from '../api.js';
import type { SortMode } from '../state.js';
import { aiStore, getAnalysisModeState } from '../stores/index.js';

function hooksFor(mode: 'risk' | 'narrative'): AnalysisHooks {
  return {
    loadResults: (partial) => loadAnalysisResults(mode, partial),
    // A server-side "Canceled" failure auto-retries while the mode is still
    // the active sort mode (a mode switch mid-run cancels the server run).
    onCanceled: () => {
      if (mode !== aiStore.state.value.sortMode) return false;
      clientLog(`poll(${mode}): auto-retrying canceled analysis`);
      aiStore.actions.setAnalysisState(mode, { status: 'idle' });
      triggerAnalysis(mode);
      return true;
    },
    onCompleted: () => {
      const ai = aiStore.state.value;
      const count = mode === 'risk'
        ? (ai.riskScores?.length ?? 0)
        : (ai.narrativeOrder?.length ?? 0);
      clientLog(`poll(${mode}): done — ${String(count)} files loaded`);
    },
  };
}

export function switchSortMode(mode: SortMode): void {
  const prevMode = aiStore.state.value.sortMode;
  aiStore.actions.update({ sortMode: mode });
  clientLog(`switchSortMode: ${prevMode} → ${mode}`);

  if (prevMode === 'risk' || prevMode === 'narrative') {
    const gen = stopPolling(prevMode);
    clientLog(`switchSortMode: stopped ${prevMode} polls (gen=${String(gen)})`);
  }

  void saveAIPreferences({ sort_mode: mode });

  if (mode === 'folder') return;

  const modeState = getAnalysisModeState(mode);
  const ai = aiStore.state.value;
  const hasResults = mode === 'risk' ? ai.riskScores !== null : ai.narrativeOrder !== null;

  if (hasResults && modeState.status === 'completed') {
    clientLog(`switchSortMode: ${mode} already completed, showing cached results`);
    return;
  }

  // Narrow to the two modes this module owns. 'guided' is handled separately
  // by `guided.ts` so we never fall into these paths with that value.
  if (mode !== 'risk' && mode !== 'narrative') return;

  if (modeState.status === 'running') {
    resumePolling(mode, hooksFor(mode));
    return;
  }

  clientLog(`switchSortMode: ${mode} status=${modeState.status}, triggering analysis`);
  triggerAnalysis(mode);
}

export function triggerAnalysis(mode: 'risk' | 'narrative', invalidateCache: boolean = false): void {
  triggerAnalysisFor(mode, hooksFor(mode), invalidateCache);
}

export function invalidateAnalysisCache(): void {
  aiStore.actions.update({
    riskScores: null,
    narrativeOrder: null,
    fileNotes: {},
  });

  aiStore.actions.setAnalysisState('risk', {
    status: 'idle',
    error: null,
    progressCompleted: 0,
    progressTotal: 0,
  });
  aiStore.actions.setAnalysisState('narrative', {
    status: 'idle',
    error: null,
    progressCompleted: 0,
    progressTotal: 0,
  });

  stopPolling('risk');
  stopPolling('narrative');

  clientLog('invalidateAnalysisCache: cleared all cached results and stopped polls');

  const sortMode = aiStore.state.value.sortMode;
  if (sortMode === 'risk' || sortMode === 'narrative') {
    triggerAnalysis(sortMode, true);
  }
}

export async function loadAnalysisResults(mode: 'risk' | 'narrative', partial: boolean = false): Promise<void> {
  const data = await getAnalysis({ type: mode });

  clientLog(`loadAnalysisResults(${mode}, partial=${String(partial)}): status=${data.status}, ${String(data.scores.length)} scores`);

  if (data.status === 'running' && !partial) {
    aiStore.actions.setAnalysisState(mode, {
      status: 'running',
      progressCompleted: data.progressCompleted ?? 0,
      progressTotal: data.progressTotal ?? 0,
    });
    clientLog(`loadAnalysisResults(${mode}): server still running, starting poll`);
    resumePolling(mode, hooksFor(mode));
  }

  if (data.scores.length === 0) return;

  for (const s of data.scores) {
    if (s.notes !== null) {
      aiStore.actions.setFileNote(s.reviewFileId, s.notes);
    }
  }

  if (mode === 'risk') {
    aiStore.actions.update({
      riskScores: data.scores.map(s => ({
        reviewFileId: s.reviewFileId,
        filePath: s.filePath,
        aggregateScore: s.aggregateScore ?? 0,
        dimensionScores: s.dimensionScores ?? {},
        rationale: s.rationale ?? '',
        sortOrder: s.sortOrder,
      })),
    });
  } else {
    aiStore.actions.update({
      narrativeOrder: data.scores.map(s => ({
        reviewFileId: s.reviewFileId,
        filePath: s.filePath,
        position: s.sortOrder,
        rationale: s.rationale ?? '',
      })),
    });
  }
}
