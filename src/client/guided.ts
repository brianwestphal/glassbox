/**
 * Guided-review analysis orchestration. The trigger/poll machinery lives in
 * the shared `analysisEngine` (GB-1083) — this module supplies the guided
 * hooks (note loading into `aiStore`) and the enabled/configured gating.
 */
import { getAnalysis } from '../api/index.js';
import type { AnalysisHooks } from './analysisEngine.js';
import { stopPolling, triggerAnalysisFor } from './analysisEngine.js';
import { clientLog } from './api.js';
import { aiStore } from './stores/index.js';

const guidedHooks: AnalysisHooks = {
  loadResults: loadGuidedResults,
};

export function triggerGuidedAnalysis(invalidateCache: boolean = false) {
  const ai = aiStore.state.value;
  if (!ai.guidedReviewEnabled || !ai.aiConfigured) return;
  triggerAnalysisFor('guided', guidedHooks, invalidateCache);
}

async function loadGuidedResults(partial: boolean) {
  const data = await getAnalysis({ type: 'guided' });

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
  stopPolling('guided');
  clientLog('invalidateGuidedAnalysis: cleared guided notes and stopped polls');

  const ai = aiStore.state.value;
  if (ai.guidedReviewEnabled && ai.aiConfigured) {
    triggerGuidedAnalysis(true);
  }
}
