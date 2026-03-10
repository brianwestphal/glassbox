import { api, clientLog } from './api.js';
import { renderFileList } from './sidebar/fileTree.js';
import { state } from './state.js';

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
  if (!state.guidedReviewEnabled || !state.aiConfigured) return;

  const gs = state.guidedAnalysis;
  if (gs.status === 'running') {
    clientLog('triggerGuidedAnalysis: already running, skipping');
    return;
  }

  clientLog(`triggerGuidedAnalysis: starting${invalidateCache ? ' (cache invalidated)' : ''}`);
  gs.status = 'running';
  gs.error = null;
  gs.progressCompleted = 0;
  gs.progressTotal = 0;
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
      gs.status = 'failed';
      gs.error = friendlyError(raw);
      renderFileList();
    }
  })();
}

function pollGuidedStatus(gen: number) {
  const gs = state.guidedAnalysis;

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
        gs.status = 'running';
        gs.progressCompleted = completed;
        gs.progressTotal = result.progressTotal ?? 0;

        if (completed > 0) {
          await loadGuidedResults(true);
        }

        renderFileList();
        setTimeout(poll, 3000);
        return;
      }

      if (result.status === 'completed') {
        clientLog('pollGuided: completed, loading final results');
        await loadGuidedResults(false);
        gs.status = 'completed';
        gs.progressCompleted = 0;
        gs.progressTotal = 0;
        renderFileList();
        return;
      }

      if (result.status === 'failed') {
        const raw = result.error ?? 'Guided analysis failed';
        clientLog(`pollGuided: failed — ${raw}`);
        console.error('Guided analysis error:', raw);
        gs.status = 'failed';
        gs.error = friendlyError(raw);
        gs.progressCompleted = 0;
        gs.progressTotal = 0;
        renderFileList();
      }
    })();
  };

  setTimeout(poll, 3000);
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
      state.guidedNotes[s.reviewFileId] = s.notes;
    }
  }
}

export function invalidateGuidedAnalysis() {
  state.guidedNotes = {};
  state.guidedAnalysis.status = 'idle';
  state.guidedAnalysis.error = null;
  state.guidedAnalysis.progressCompleted = 0;
  state.guidedAnalysis.progressTotal = 0;
  pollGeneration++;
  clientLog('invalidateGuidedAnalysis: cleared guided notes and stopped polls');

  if (state.guidedReviewEnabled && state.aiConfigured) {
    triggerGuidedAnalysis(true);
  }
}
