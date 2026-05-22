import { getAnalysis, getAnalysisStatus, saveAIPreferences, startAnalysis } from '../../api/index.js';
import { clientLog } from '../api.js';
import type { SortMode } from '../state.js';
import { aiStore, getAnalysisModeState } from '../stores/index.js';
import { ANALYSIS_POLL_INTERVAL_MS } from '../timing.js';

// Per-mode poll generation counters — each mode only invalidates its own polls.
const pollGenerations: Record<string, number> = { risk: 0, narrative: 0 };

export function switchSortMode(mode: SortMode): void {
  const prevMode = aiStore.state.value.sortMode;
  aiStore.actions.update({ sortMode: mode });
  clientLog(`switchSortMode: ${prevMode} → ${mode}`);

  if (prevMode === 'risk' || prevMode === 'narrative') {
    pollGenerations[prevMode]++;
    clientLog(`switchSortMode: stopped ${prevMode} polls (gen=${String(pollGenerations[prevMode])})`);
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

  if (modeState.status === 'running') {
    pollGenerations[mode]++;
    clientLog(`switchSortMode: ${mode} is running, resuming poll (gen=${String(pollGenerations[mode])})`);
    pollAnalysisStatus(mode, pollGenerations[mode]);
    return;
  }

  clientLog(`switchSortMode: ${mode} status=${modeState.status}, triggering analysis`);
  triggerAnalysis(mode);
}

function friendlyError(raw: string): string {
  if (raw.includes('429') || raw.toLowerCase().includes('rate_limit') || raw.toLowerCase().includes('rate limit')) {
    return 'Rate limit exceeded. Please wait a moment and try again.';
  }
  if (raw.includes('401') || raw.toLowerCase().includes('unauthorized')) {
    return 'Invalid API key. Check your AI settings.';
  }
  if (raw.includes('403') || raw.toLowerCase().includes('forbidden')) {
    return 'Access denied. Check your API key permissions.';
  }
  if (/\b(500|502|503|504)\b/.test(raw)) {
    return 'AI service temporarily unavailable. Try again later.';
  }
  if (raw.toLowerCase().includes('fetch failed') || raw.toLowerCase().includes('network')) {
    return 'Network error. Check your internet connection.';
  }
  if (raw.toLowerCase().includes('timed out')) {
    return 'Analysis timed out. Try again.';
  }
  return raw.length > 120 ? raw.slice(0, 120) + '...' : raw;
}

export function triggerAnalysis(mode: 'risk' | 'narrative', invalidateCache: boolean = false): void {
  const modeState = getAnalysisModeState(mode);

  if (modeState.status === 'running') {
    clientLog(`triggerAnalysis(${mode}): already running, skipping`);
    return;
  }

  clientLog(`triggerAnalysis(${mode}): starting${invalidateCache ? ' (cache invalidated)' : ''}`);
  aiStore.actions.setAnalysisState(mode, {
    status: 'running',
    error: null,
    progressCompleted: 0,
    progressTotal: 0,
  });
  pollGenerations[mode]++;
  const gen = pollGenerations[mode];

  void (async () => {
    try {
      await startAnalysis({ type: mode, invalidateCache });
      if (gen !== pollGenerations[mode]) return;
      clientLog(`triggerAnalysis(${mode}): server accepted, starting poll (gen=${String(gen)})`);
      pollAnalysisStatus(mode, gen);
    } catch (err: unknown) {
      if (gen !== pollGenerations[mode]) return;
      const raw = err instanceof Error ? err.message : 'Failed to start analysis';
      console.error('Analysis error:', raw);
      clientLog(`triggerAnalysis(${mode}): failed — ${raw}`);
      aiStore.actions.setAnalysisState(mode, {
        status: 'failed',
        error: friendlyError(raw),
      });
    }
  })();
}

function pollAnalysisStatus(mode: 'risk' | 'narrative', gen: number): void {
  let lastCompleted = -1;

  const poll = () => {
    if (gen !== pollGenerations[mode]) {
      clientLog(`poll(${mode}): stale gen=${String(gen)} vs current=${String(pollGenerations[mode])}, stopping`);
      return;
    }

    void (async () => {
      const result = await getAnalysisStatus({ type: mode });
      if (gen !== pollGenerations[mode]) return;

      if (result.status === 'running') {
        const completed = result.progressCompleted ?? 0;
        aiStore.actions.setAnalysisState(mode, {
          status: 'running',
          progressCompleted: completed,
          progressTotal: result.progressTotal ?? 0,
        });

        if (completed > 0 && completed !== lastCompleted) {
          clientLog(`poll(${mode}): progress ${String(completed)}/${String(result.progressTotal ?? 0)}, fetching partial results`);
          lastCompleted = completed;
          await loadAnalysisResults(mode, true);
        }

        setTimeout(poll, ANALYSIS_POLL_INTERVAL_MS);
        return;
      }

      if (result.status === 'completed') {
        clientLog(`poll(${mode}): completed, loading final results`);
        await loadAnalysisResults(mode, false);
        aiStore.actions.setAnalysisState(mode, {
          status: 'completed',
          progressCompleted: 0,
          progressTotal: 0,
        });
        const ai = aiStore.state.value;
        const count = mode === 'risk'
          ? (ai.riskScores?.length ?? 0)
          : (ai.narrativeOrder?.length ?? 0);
        clientLog(`poll(${mode}): done — ${String(count)} files loaded`);
        return;
      }

      if (result.status === 'failed') {
        const raw = result.error ?? 'Analysis failed';
        clientLog(`poll(${mode}): failed — ${raw}`);
        if (raw === 'Canceled' && mode === aiStore.state.value.sortMode) {
          clientLog(`poll(${mode}): auto-retrying canceled analysis`);
          aiStore.actions.setAnalysisState(mode, { status: 'idle' });
          triggerAnalysis(mode);
          return;
        }
        console.error('Analysis error:', raw);
        aiStore.actions.setAnalysisState(mode, {
          status: 'failed',
          error: friendlyError(raw),
          progressCompleted: 0,
          progressTotal: 0,
        });
      }
    })();
  };

  setTimeout(poll, ANALYSIS_POLL_INTERVAL_MS);
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

  pollGenerations.risk++;
  pollGenerations.narrative++;

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
    pollGenerations[mode]++;
    clientLog(`loadAnalysisResults(${mode}): server still running, starting poll (gen=${String(pollGenerations[mode])})`);
    pollAnalysisStatus(mode, pollGenerations[mode]);
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
