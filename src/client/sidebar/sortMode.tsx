import { raw } from '../../jsx-runtime.js';
import { api, clientLog } from '../api.js';
import { toElement } from '../dom.js';
import type { SortMode } from '../state.js';
import { getAnalysisState, state } from '../state.js';
import { renderFileList } from './fileTree.js';

// Lucide icons (SVG)
const ICON_FOLDER = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const ICON_SHIELD = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>';
const ICON_BOOK = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>';

export function renderSortControl(): HTMLElement {
  const control = toElement(
    <div className="sort-mode-bar">
      <div className="segmented-control sort-mode-control">
        <button className={`segment sort-segment${state.sortMode === 'folder' ? ' active' : ''}`}
          data-sort-mode="folder" title="Group by folder">
          {raw(ICON_FOLDER)}
        </button>
        <button className={`segment sort-segment${state.sortMode === 'risk' ? ' active' : ''}`}
          data-sort-mode="risk" title="Sort by risk">
          {raw(ICON_SHIELD)}
        </button>
        <button className={`segment sort-segment${state.sortMode === 'narrative' ? ' active' : ''}`}
          data-sort-mode="narrative" title="Reading order">
          {raw(ICON_BOOK)}
        </button>
      </div>
      <div className="sort-risk-controls" style={state.sortMode === 'risk' ? '' : 'display:none'}>
        <button className={`toolbar-btn sort-risk-toggle${state.showRiskScores ? ' active' : ''}`}
          id="toggle-risk-scores" title="Show risk scores">
          Score
        </button>
        <select className="sort-dimension-select" id="risk-dimension-select">
          <option value="aggregate">Aggregate</option>
          <option value="security">Security</option>
          <option value="correctness">Correctness</option>
          <option value="error-handling">Error Handling</option>
          <option value="maintainability">Maintainability</option>
          <option value="architecture">Architecture</option>
          <option value="performance">Performance</option>
        </select>
      </div>
    </div>
  );

  // Set current dimension selection
  const dimensionSelect = control.querySelector<HTMLSelectElement>('#risk-dimension-select');
  if (dimensionSelect !== null) {
    dimensionSelect.value = state.riskSortDimension;
  }

  return control;
}

export function bindSortMode() {
  document.querySelectorAll('.sort-segment').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.sortMode as SortMode;
      if (mode === state.sortMode) return;

      if ((mode === 'risk' || mode === 'narrative') && !state.aiConfigured) {
        // Import dynamically to avoid circular deps
        void import('../settings/dialog.js').then(m => {
          m.showSettingsDialog(() => {
            switchSortMode(mode);
          });
        });
        return;
      }

      switchSortMode(mode);
    });
  });

  const toggleBtn = document.getElementById('toggle-risk-scores');
  if (toggleBtn !== null) {
    toggleBtn.addEventListener('click', () => {
      state.showRiskScores = !state.showRiskScores;
      toggleBtn.classList.toggle('active', state.showRiskScores);
      void api('/ai/preferences', {
        method: 'POST',
        body: { show_risk_scores: state.showRiskScores },
      });
      renderFileList();
    });
  }

  const dimensionSelect = document.getElementById('risk-dimension-select') as HTMLSelectElement | null;
  if (dimensionSelect !== null) {
    dimensionSelect.addEventListener('change', () => {
      state.riskSortDimension = dimensionSelect.value;
      void api('/ai/preferences', {
        method: 'POST',
        body: { risk_sort_dimension: dimensionSelect.value },
      });
      renderFileList();
    });
  }
}

function switchSortMode(mode: SortMode) {
  const prevMode = state.sortMode;
  state.sortMode = mode;
  clientLog(`switchSortMode: ${prevMode} → ${mode}`);

  // Stop polls for the previous mode — no need to poll for something not displayed
  if (prevMode === 'risk' || prevMode === 'narrative') {
    pollGenerations[prevMode]++;
    clientLog(`switchSortMode: stopped ${prevMode} polls (gen=${String(pollGenerations[prevMode])})`);
  }

  // Update button states
  document.querySelectorAll('.sort-segment').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.sortMode === mode);
  });

  // Show/hide risk controls
  const riskControls = document.querySelector<HTMLElement>('.sort-risk-controls');
  if (riskControls !== null) {
    riskControls.style.display = mode === 'risk' ? '' : 'none';
  }

  // Save preference
  void api('/ai/preferences', { method: 'POST', body: { sort_mode: mode } });

  if (mode === 'folder') {
    renderFileList();
    return;
  }

  const modeState = getAnalysisState(mode);
  const hasResults = mode === 'risk' ? state.riskScores !== null : state.narrativeOrder !== null;

  // If analysis completed with results, just show them
  if (hasResults && modeState.status === 'completed') {
    clientLog(`switchSortMode: ${mode} already completed, showing cached results`);
    renderFileList();
    return;
  }

  // If analysis is running (or client thinks it is), resume polling to get latest status
  if (modeState.status === 'running') {
    pollGenerations[mode]++;
    clientLog(`switchSortMode: ${mode} is running, resuming poll (gen=${String(pollGenerations[mode])})`);
    pollAnalysisStatus(mode, pollGenerations[mode]);
    renderFileList();
    return;
  }

  // Otherwise (idle, failed, or incomplete results), trigger new analysis
  clientLog(`switchSortMode: ${mode} status=${modeState.status}, triggering analysis`);
  triggerAnalysis(mode);
}

// Per-mode poll generation counters — each mode only invalidates its own polls.
// When triggerAnalysis('risk') is called, only risk's counter increments,
// so a narrative poll keeps running (and vice versa).
const pollGenerations: Record<string, number> = { risk: 0, narrative: 0 };

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

export function triggerAnalysis(mode: 'risk' | 'narrative') {
  const modeState = getAnalysisState(mode);

  // Skip if already running for this mode
  if (modeState.status === 'running') {
    clientLog(`triggerAnalysis(${mode}): already running, skipping`);
    return;
  }

  clientLog(`triggerAnalysis(${mode}): starting`);
  modeState.status = 'running';
  modeState.error = null;
  modeState.progressCompleted = 0;
  modeState.progressTotal = 0;
  pollGenerations[mode]++;
  const gen = pollGenerations[mode];
  renderFileList(); // Shows loading state

  void (async () => {
    try {
      await api('/ai/analyze', { method: 'POST', body: { type: mode } });
      if (gen !== pollGenerations[mode]) return; // Stale
      clientLog(`triggerAnalysis(${mode}): server accepted, starting poll (gen=${String(gen)})`);
      pollAnalysisStatus(mode, gen);
    } catch (err: unknown) {
      if (gen !== pollGenerations[mode]) return; // Stale
      const raw = err instanceof Error ? err.message : 'Failed to start analysis';
      console.error('Analysis error:', raw);
      clientLog(`triggerAnalysis(${mode}): failed — ${raw}`);
      modeState.status = 'failed';
      modeState.error = friendlyError(raw);
      renderFileList();
    }
  })();
}

function pollAnalysisStatus(mode: 'risk' | 'narrative', gen: number) {
  let lastCompleted = -1;
  const modeState = getAnalysisState(mode);

  const poll = () => {
    if (gen !== pollGenerations[mode]) {
      clientLog(`poll(${mode}): stale gen=${String(gen)} vs current=${String(pollGenerations[mode])}, stopping`);
      return;
    }

    void (async () => {
      const result = await api<{
        status: string;
        error?: string;
        progressCompleted?: number;
        progressTotal?: number;
      }>(`/ai/analysis/${mode}/status`);
      if (gen !== pollGenerations[mode]) return; // Stale

      if (result.status === 'running') {
        const completed = result.progressCompleted ?? 0;
        modeState.status = 'running';
        modeState.progressCompleted = completed;
        modeState.progressTotal = result.progressTotal ?? 0;

        // Only fetch partial results when progress has actually advanced
        if (completed > 0 && completed !== lastCompleted) {
          clientLog(`poll(${mode}): progress ${String(completed)}/${String(result.progressTotal ?? 0)}, fetching partial results`);
          lastCompleted = completed;
          await loadAnalysisResults(mode, true);
        }

        renderFileList();
        setTimeout(poll, 3000);
        return;
      }

      if (result.status === 'completed') {
        clientLog(`poll(${mode}): completed, loading final results`);
        await loadAnalysisResults(mode, false);
        modeState.status = 'completed';
        modeState.progressCompleted = 0;
        modeState.progressTotal = 0;
        const count = mode === 'risk'
          ? (state.riskScores?.length ?? 0)
          : (state.narrativeOrder?.length ?? 0);
        clientLog(`poll(${mode}): done — ${String(count)} files loaded`);
        renderFileList();
        return;
      }

      if (result.status === 'failed') {
        const raw = result.error ?? 'Analysis failed';
        clientLog(`poll(${mode}): failed — ${raw}`);
        // If cancelled (user switched modes then came back), auto-retry with caching
        if (raw === 'Cancelled' && mode === state.sortMode) {
          clientLog(`poll(${mode}): auto-retrying cancelled analysis`);
          modeState.status = 'idle'; // Reset so triggerAnalysis doesn't skip
          triggerAnalysis(mode);
          return;
        }
        console.error('Analysis error:', raw);
        modeState.status = 'failed';
        modeState.error = friendlyError(raw);
        modeState.progressCompleted = 0;
        modeState.progressTotal = 0;
        renderFileList();
      }
    })();
  };

  setTimeout(poll, 3000);
}

export async function loadAnalysisResults(mode: 'risk' | 'narrative', partial: boolean = false) {
  const modeState = getAnalysisState(mode);
  const data = await api<{
    status: string;
    progressCompleted?: number;
    progressTotal?: number;
    scores: Array<{
      reviewFileId: string;
      filePath: string;
      sortOrder: number;
      aggregateScore: number | null;
      rationale: string | null;
      dimensionScores: Record<string, number> | null;
      notes: { overview: string; lines: Array<{ line: number; content: string }> } | null;
    }>;
  }>(`/ai/analysis/${mode}`);

  clientLog(`loadAnalysisResults(${mode}, partial=${String(partial)}): status=${data.status}, ${String(data.scores.length)} scores`);

  // If server says a previous analysis is still running and we're not already polling, resume polling
  if (data.status === 'running' && !partial) {
    modeState.status = 'running';
    modeState.progressCompleted = data.progressCompleted ?? 0;
    modeState.progressTotal = data.progressTotal ?? 0;
    pollGenerations[mode]++;
    clientLog(`loadAnalysisResults(${mode}): server still running, starting poll (gen=${String(pollGenerations[mode])})`);
    pollAnalysisStatus(mode, pollGenerations[mode]);
    // Fall through to store any partial scores
  }

  if (data.scores.length === 0) return;

  // Store notes keyed by reviewFileId
  for (const s of data.scores) {
    if (s.notes !== null) {
      state.fileNotes[s.reviewFileId] = s.notes;
    }
  }

  if (mode === 'risk') {
    state.riskScores = data.scores.map(s => ({
      reviewFileId: s.reviewFileId,
      filePath: s.filePath,
      aggregateScore: s.aggregateScore ?? 0,
      dimensionScores: s.dimensionScores ?? {},
      rationale: s.rationale ?? '',
      sortOrder: s.sortOrder,
    }));
  } else {
    state.narrativeOrder = data.scores.map(s => ({
      reviewFileId: s.reviewFileId,
      filePath: s.filePath,
      position: s.sortOrder,
      rationale: s.rationale ?? '',
    }));
  }
}
