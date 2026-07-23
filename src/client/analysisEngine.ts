/**
 * Shared AI-analysis trigger/poll engine (GB-1083) — the single implementation
 * behind risk, narrative, and guided analysis. `sortMode.ts` and `guided.ts`
 * previously carried near-verbatim copies of this machinery; they now pass a
 * small per-mode hooks object instead.
 *
 * Resilience (GB-1082): each poll tick is guarded — a transient fetch failure
 * re-schedules the poll instead of dying as an unhandled rejection (which left
 * the sidebar stuck on "running" forever). After `MAX_CONSECUTIVE_POLL_ERRORS`
 * back-to-back failures the mode transitions to `failed` with a friendly
 * message, so a dead server surfaces instead of polling silently.
 */
import { getAnalysisStatus, startAnalysis } from '../api/index.js';
import { friendlyError } from './aiError.js';
import { clientLog } from './api.js';
import { aiStore, getAnalysisModeState } from './stores/index.js';
import { ANALYSIS_POLL_INTERVAL_MS } from './timing.js';

export type AnalysisType = 'risk' | 'narrative' | 'guided';

export interface AnalysisHooks {
  /** Pull results into the store (`partial` while running, final on completion). */
  loadResults: (partial: boolean) => Promise<void>;
  /** Optional handler for a server-side "Canceled" failure. Return true when
   *  the mode re-triggered itself (risk/narrative auto-retry while active). */
  onCanceled?: () => boolean;
  /** Optional post-completion callback (e.g. logging loaded counts). */
  onCompleted?: () => void;
}

/** Consecutive poll-tick failures tolerated before the mode is marked failed. */
export const MAX_CONSECUTIVE_POLL_ERRORS = 5;

// Per-mode poll generation counters — each mode only invalidates its own polls.
const pollGenerations: Record<AnalysisType, number> = { risk: 0, narrative: 0, guided: 0 };

/** Invalidate any in-flight poll for the mode (bumps its generation). */
export function stopPolling(type: AnalysisType): number {
  return ++pollGenerations[type];
}

/** Resume polling an already-running analysis (e.g. after a mode switch back). */
export function resumePolling(type: AnalysisType, hooks: AnalysisHooks): void {
  const gen = stopPolling(type);
  clientLog(`analysis(${type}): resuming poll (gen=${String(gen)})`);
  pollStatus(type, gen, hooks);
}

/** Start (or restart) an analysis run and poll it to completion. */
export function triggerAnalysisFor(type: AnalysisType, hooks: AnalysisHooks, invalidateCache = false): void {
  if (getAnalysisModeState(type).status === 'running') {
    clientLog(`analysis(${type}): already running, skipping trigger`);
    return;
  }

  clientLog(`analysis(${type}): starting${invalidateCache ? ' (cache invalidated)' : ''}`);
  aiStore.actions.setAnalysisState(type, {
    status: 'running',
    error: null,
    progressCompleted: 0,
    progressTotal: 0,
  });
  const gen = stopPolling(type);

  void (async () => {
    try {
      const result = await startAnalysis({ type, invalidateCache });
      if (gen !== pollGenerations[type]) return;
      // `startAnalysis` resolves to a success-or-error union (a 4xx/5xx returns
      // `{ error }` rather than throwing — see `apiCall`). Surface the rejection
      // as a failed state instead of polling a server that never started the
      // run, which left the UI stuck on "running" forever (GB-927).
      if ('error' in result) {
        console.error('Analysis error:', result.error);
        clientLog(`analysis(${type}): server rejected — ${result.error}`);
        aiStore.actions.setAnalysisState(type, {
          status: 'failed',
          error: friendlyError(result.error),
          progressCompleted: 0,
          progressTotal: 0,
        });
        return;
      }
      clientLog(`analysis(${type}): server accepted, starting poll (gen=${String(gen)})`);
      pollStatus(type, gen, hooks);
    } catch (err: unknown) {
      if (gen !== pollGenerations[type]) return;
      const raw = err instanceof Error ? err.message : 'Failed to start analysis';
      console.error('Analysis error:', raw);
      clientLog(`analysis(${type}): failed — ${raw}`);
      aiStore.actions.setAnalysisState(type, {
        status: 'failed',
        error: friendlyError(raw),
      });
    }
  })();
}

function pollStatus(type: AnalysisType, gen: number, hooks: AnalysisHooks): void {
  let lastCompleted = -1;
  let consecutiveErrors = 0;

  const poll = () => {
    if (gen !== pollGenerations[type]) {
      clientLog(`poll(${type}): stale gen=${String(gen)} vs current=${String(pollGenerations[type])}, stopping`);
      return;
    }

    void (async () => {
      let result: Awaited<ReturnType<typeof getAnalysisStatus>>;
      try {
        result = await getAnalysisStatus({ type });
        consecutiveErrors = 0;
      } catch (err: unknown) {
        // GB-1082: a transient failure must not kill the poll chain — the old
        // code let the rejection escape, so the sidebar sat on "running"
        // forever with nothing re-scheduling.
        if (gen !== pollGenerations[type]) return;
        consecutiveErrors++;
        const raw = err instanceof Error ? err.message : String(err);
        clientLog(`poll(${type}): tick failed (${String(consecutiveErrors)}/${String(MAX_CONSECUTIVE_POLL_ERRORS)}) — ${raw}`);
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          console.error('Analysis polling failed:', raw);
          aiStore.actions.setAnalysisState(type, {
            status: 'failed',
            error: friendlyError(raw),
            progressCompleted: 0,
            progressTotal: 0,
          });
          return;
        }
        setTimeout(poll, ANALYSIS_POLL_INTERVAL_MS);
        return;
      }
      if (gen !== pollGenerations[type]) return;

      if (result.status === 'running') {
        const completed = result.progressCompleted ?? 0;
        aiStore.actions.setAnalysisState(type, {
          status: 'running',
          progressCompleted: completed,
          progressTotal: result.progressTotal ?? 0,
        });

        if (completed > 0 && completed !== lastCompleted) {
          clientLog(`poll(${type}): progress ${String(completed)}/${String(result.progressTotal ?? 0)}, fetching partial results`);
          lastCompleted = completed;
          // Partial-load failures are tolerable — the next tick retries.
          await hooks.loadResults(true).catch((err: unknown) => {
            clientLog(`poll(${type}): partial load failed — ${err instanceof Error ? err.message : String(err)}`);
          });
        }

        setTimeout(poll, ANALYSIS_POLL_INTERVAL_MS);
        return;
      }

      if (result.status === 'completed') {
        clientLog(`poll(${type}): completed, loading final results`);
        try {
          await hooks.loadResults(false);
        } catch (err: unknown) {
          const raw = err instanceof Error ? err.message : String(err);
          clientLog(`poll(${type}): final load failed — ${raw}`);
          aiStore.actions.setAnalysisState(type, {
            status: 'failed',
            error: friendlyError(raw),
            progressCompleted: 0,
            progressTotal: 0,
          });
          return;
        }
        aiStore.actions.setAnalysisState(type, {
          status: 'completed',
          progressCompleted: 0,
          progressTotal: 0,
        });
        hooks.onCompleted?.();
        return;
      }

      if (result.status === 'failed') {
        const raw = result.error ?? 'Analysis failed';
        clientLog(`poll(${type}): failed — ${raw}`);
        if (raw === 'Canceled' && hooks.onCanceled?.() === true) {
          clientLog(`poll(${type}): canceled run re-triggered by mode hook`);
          return;
        }
        console.error('Analysis error:', raw);
        aiStore.actions.setAnalysisState(type, {
          status: 'failed',
          error: friendlyError(raw),
          progressCompleted: 0,
          progressTotal: 0,
        });
        return;
      }

      // Any other status — notably 'none', meaning the run vanished mid-poll
      // (server restarted, or the analysis row was invalidated elsewhere).
      // Falling through silently here ended the poll chain with the mode stuck
      // on "running" forever, the same hang shape as GB-927. Exit the running
      // state loudly instead.
      clientLog(`poll(${type}): unexpected status '${result.status}' mid-run — exiting running state`);
      aiStore.actions.setAnalysisState(type, {
        status: 'failed',
        error: 'The analysis run disappeared (was the server restarted?) — try again.',
        progressCompleted: 0,
        progressTotal: 0,
      });
    })();
  };

  setTimeout(poll, ANALYSIS_POLL_INTERVAL_MS);
}
