import { api, clientLog } from './api.js';
import { renderFileList } from './sidebar/fileTree.js';
import { aiStore } from './stores/index.js';
import { ANALYSIS_POLL_INTERVAL_MS } from './timing.js';

let pollGeneration = 0;

function friendlyError(raw: string): string {
  if (raw.includes('429') || raw.toLowerCase().includes('rate_limit') || raw.toLowerCase().includes('rate limit')) {
    return 'Rate limit exceeded. Please wait a moment and try again.';
  }
  if (raw.includes('401') || raw.toLowerCase().includes('unauthorized')) {
    return 'Invalid API key. Check your AI settings.';
  }
  if (/\b(500|502|503|504)\b/.test(raw)) {
    return 'AI service temporarily unavailable. Try again later.';
  }
  return raw.length > 120 ? raw.slice(0, 120) + '...' : raw;
}

export function triggerGuidedAnalysis(invalidateCache: boolean = false) {
  const ai = aiStore.state.value;
  if (!ai.guidedReviewEnabled || !ai.aiConfigured) return;

  if (ai.guidedAnalysis.status === 'running') {
    clientLog('triggerGuidedAnalysis: already running, skipping');
    return;
  }

  clientLog(`triggerGuidedAnalysis: starting${invalidateCache ? ' (cache invalidated)' : ''}`);
  aiStore.actions.setAnalysisState('guided', {
    status: 'running',
    error: null,
    progressCompleted: 0,
    progressTotal: 0,
  });
  pollGeneration++;
  const gen = pollGeneration;
  renderFileList();

  void (async () => {
    try {
      await api('/ai/analyze', { method: 'POST', body: { type: 'guided', invalidateCache } });
      if (gen !== pollGeneration) return;
      clientLog(`triggerGuidedAnalysis: server accepted, starting poll (gen=${String(gen)})`);
      pollGuidedStatus(gen);
    } catch (err: unknown) {
      if (gen !== pollGeneration) return;
      const raw = err instanceof Error ? err.message : 'Failed to start guided analysis';
      console.error('Guided analysis error:', raw);
      clientLog(`triggerGuidedAnalysis: failed — ${raw}`);
      aiStore.actions.setAnalysisState('guided', {
        status: 'failed',
        error: friendlyError(raw),
      });
      renderFileList();
    }
  })();
}

function pollGuidedStatus(gen: number) {
  const poll = () => {
    if (gen !== pollGeneration) {
      clientLog(`pollGuided: stale gen=${String(gen)}, stopping`);
      return;
    }

    void (async () => {
      const result = await api<{
        status: string;
        error?: string;
        progressCompleted?: number;
        progressTotal?: number;
      }>('/ai/analysis/guided/status');
      if (gen !== pollGeneration) return;

      if (result.status === 'running') {
        const completed = result.progressCompleted ?? 0;
        aiStore.actions.setAnalysisState('guided', {
          status: 'running',
          progressCompleted: completed,
          progressTotal: result.progressTotal ?? 0,
        });

        if (completed > 0) {
          await loadGuidedResults(true);
        }

        renderFileList();
        setTimeout(poll, ANALYSIS_POLL_INTERVAL_MS);
        return;
      }

      if (result.status === 'completed') {
        clientLog('pollGuided: completed, loading final results');
        await loadGuidedResults(false);
        aiStore.actions.setAnalysisState('guided', {
          status: 'completed',
          progressCompleted: 0,
          progressTotal: 0,
        });
        renderFileList();
        return;
      }

      if (result.status === 'failed') {
        const raw = result.error ?? 'Guided analysis failed';
        clientLog(`pollGuided: failed — ${raw}`);
        console.error('Guided analysis error:', raw);
        aiStore.actions.setAnalysisState('guided', {
          status: 'failed',
          error: friendlyError(raw),
          progressCompleted: 0,
          progressTotal: 0,
        });
        renderFileList();
      }
    })();
  };

  setTimeout(poll, ANALYSIS_POLL_INTERVAL_MS);
}

async function loadGuidedResults(partial: boolean) {
  const data = await api<{
    status: string;
    scores: Array<{
      reviewFileId: string;
      notes: { overview: string; lines: Array<{ line: number; content: string }> } | null;
    }>;
  }>('/ai/analysis/guided');

  clientLog(`loadGuidedResults(partial=${String(partial)}): ${String(data.scores.length)} entries`);

  for (const s of data.scores) {
    if (s.notes !== null) {
      aiStore.actions.setGuidedNote(s.reviewFileId, s.notes);
    }
  }
}

export function invalidateGuidedAnalysis() {
  aiStore.actions.update({ guidedNotes: {} });
  aiStore.actions.setAnalysisState('guided', {
    status: 'idle',
    error: null,
    progressCompleted: 0,
    progressTotal: 0,
  });
  pollGeneration++;
  clientLog('invalidateGuidedAnalysis: cleared guided notes and stopped polls');

  const ai = aiStore.state.value;
  if (ai.guidedReviewEnabled && ai.aiConfigured) {
    triggerGuidedAnalysis(true);
  }
}
