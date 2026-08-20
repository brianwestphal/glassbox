import type { SafeHtml } from 'kerfjs';
import { attr, delegate, signal } from 'kerfjs';
import { choice, overlay } from 'kerfjs/overlay';

import {
  completeReview as apiCompleteReview,
  deleteStaleAnnotations,
  getChannelStatus,
  keepAllStaleAnnotations,
  reopenReview,
  triggerChannel,
} from '../../api/index.js';
import { asButton, asEl, toElement } from '../dom.js';
import { reviewStore } from '../stores/index.js';
import { SEND_TO_CLAUDE_CLOSE_MS, TOAST_DURATION_MS } from '../timing.js';

const ACTIONS = {
  modalDone: attr('data-action', 'modal-done'),
  sendToClaude: attr('data-action', 'send-to-claude'),
} as const;

interface CompleteResult {
  isCurrent: boolean;
  reviewId: string;
  exportPath: string;
  /** Outcome of the --on-complete hook (doc 2 §2.3a / GB-974), if one was set. */
  hook?: { ran: boolean; ok: boolean; exitCode: number | null; error?: string };
}

type ModalStage =
  | { kind: 'completing' }
  | {
      kind: 'done';
      result: CompleteResult;
      aiCommand: string;
      channelConnected: boolean;
    }
  // A failed API call (complete / stale resolution) — previously the modal sat
  // on "Completing..." forever with no exit (GB-1082).
  | { kind: 'failed'; message: string };

export function bindCompleteButton(): void {
  const root = document.querySelector<HTMLElement>('.review-app') ?? document.body;
  void delegate(root, 'click', '#complete-review', () => { showCompleteModal(); });
}

export function bindReopenButton(): void {
  const root = document.querySelector<HTMLElement>('.review-app') ?? document.body;
  void delegate(root, 'click', '#reopen-review', (_e, btn) => {
    void (async () => {
      await reopenReview();
      const completeBtn = toElement(
        <button className="btn btn-primary btn-complete" id="complete-review">Complete Review</button>
      );
      asEl(btn).replaceWith(completeBtn);
      // The delegate above is bound to a stable ancestor (`.review-app`)
      // so the click still fires on the freshly-inserted `#complete-review`
      // without needing to re-bind anything.
    })();
  });
}

function showCompleteModal(): void {
  const staleCounts = reviewStore.state.value.staleCounts;
  let totalStale = 0;
  Object.keys(staleCounts).forEach(k => { totalStale += (staleCounts[k] ?? 0); });

  if (totalStale === 0) {
    void completeReview(openCompletionModal({ kind: 'completing' }));
    return;
  }

  // The stale decision is an N-way choice, so it's kerfjs/overlay's `choice()`
  // (focus-trapped, Enter resolves the safe default 'keep', Escape / backdrop /
  // dismissal resolves null) rather than a stage of the completion modal. Its
  // buttons carry Glassbox's own `.btn` classes so they match the app.
  void (async () => {
    const pick = await choice<'cancel' | 'discard' | 'keep'>(staleMessage(totalStale), [
      { value: 'cancel', label: 'Cancel', className: 'btn btn-sm' },
      { value: 'discard', label: 'Discard All Stale', className: 'btn btn-sm btn-danger' },
      { value: 'keep', label: 'Keep All & Complete', className: 'btn btn-sm btn-primary' },
    ], { title: 'Stale Annotations', defaultValue: 'keep' });
    if (pick === null || pick === 'cancel') return;

    // Show the completion modal on "Completing..." while the stale resolution
    // and the completion request run.
    const stage = openCompletionModal({ kind: 'completing' });
    try {
      if (pick === 'discard') await deleteStaleAnnotations();
      else await keepAllStaleAnnotations();
    } catch (err: unknown) {
      const what = pick === 'discard' ? 'Discarding stale annotations failed' : 'Keeping stale annotations failed';
      stage.value = { kind: 'failed', message: failureMessage(what, err) };
      return;
    }
    reviewStore.actions.update({ staleCounts: {} });
    void completeReview(stage);
  })();
}

/** Build + show the completion modal (completing → done/failed stages) and
 *  return its `stage` signal so the caller can drive it. The stale decision is
 *  handled separately by `choice()` before this is called. */
function openCompletionModal(initialStage: ModalStage): ReturnType<typeof signal<ModalStage>> {
  const stage = signal<ModalStage>(initialStage);

  // The whole modal — `.modal-overlay` backdrop, the `.modal` content mount,
  // Escape/backdrop dismissal, focus trap, and focus restore — is owned by
  // kerfjs/overlay (replaces the hand-rolled append + mount + backdrop listener
  // + disposeMount). The render fn reads `stage.value`, so the caller driving
  // `stage` (completing → done/failed) re-runs the mount automatically.
  const handle = overlay(
    () => <div className="modal">{renderStage(stage.value)}</div>,
    { className: 'modal-overlay', dismiss: ['escape', 'backdrop'], trap: true },
  );

  // Delegated handlers on the overlay wrapper (`handle.el`) — the mount root,
  // stable across the stage re-renders.
  void delegate(handle.el, 'click', ACTIONS.modalDone.selector, () => { handle.close(); });

  void delegate(handle.el, 'click', '.modal-copyable', (_e, el) => {
    const copyText = asEl(el).dataset.copy ?? '';
    void navigator.clipboard.writeText(copyText);
    asEl(el).classList.add('copied');
    setTimeout(() => { asEl(el).classList.remove('copied'); }, TOAST_DURATION_MS);
  });

  void delegate(handle.el, 'click', ACTIONS.sendToClaude.selector, (_e, btn) => {
    if (stage.value.kind !== 'done') return;
    const aiCommand = stage.value.aiCommand;
    const sendBtn = asButton(btn);
    void (async () => {
      try {
        await triggerChannel({ message: aiCommand });
      } catch {
        sendBtn.textContent = 'Send failed — retry';
        return;
      }
      sendBtn.textContent = 'Sent!';
      sendBtn.setAttribute('disabled', 'true');
      setTimeout(() => { handle.close(); }, SEND_TO_CLAUDE_CLOSE_MS);
    })();
  });

  return stage;
}

function staleMessage(totalStale: number): string {
  return 'There ' + (totalStale === 1
    ? 'is 1 stale annotation'
    : `are ${String(totalStale)} stale annotations`) +
    ' that could not be matched to the current diff. What would you like to do?';
}

function failureMessage(prefix: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return `${prefix}: ${raw}`;
}

async function completeReview(stage: ReturnType<typeof signal<ModalStage>>): Promise<void> {
  let result: CompleteResult;
  try {
    result = await apiCompleteReview();
  } catch (err: unknown) {
    // Without this the modal showed "Completing..." forever after a failed
    // request, with clicking outside as the only escape (GB-1082).
    stage.value = { kind: 'failed', message: failureMessage('Completing the review failed', err) };
    return;
  }
  const aiCommand = result.isCurrent
    ? 'Read .glassbox/latest-review.md and apply the feedback.'
    : 'Read .glassbox/review-' + result.reviewId + '.md and apply the feedback.';

  // Default to disconnected; we'll update once we know.
  stage.value = { kind: 'done', result, aiCommand, channelConnected: false };

  // Swap the toolbar's Complete button for a Reopen button — this lives
  // outside the modal and persists after close. The delegate in
  // `bindReopenButton()` is bound at `.review-app`, so the freshly-inserted
  // element still gets a click handler without rebinding.
  const completeBtn = document.getElementById('complete-review');
  if (completeBtn !== null) {
    const reopenBtn = toElement(
      <button className="btn btn-primary" id="reopen-review">Reopen Review</button>
    );
    completeBtn.replaceWith(reopenBtn);
  }

  try {
    const channelStatus = await getChannelStatus();
    if (channelStatus.enabled && channelStatus.connected) {
      // `stage.value` has been narrowed to `{ kind: 'done', ... }` by TS
      // flow analysis since we assigned that shape above, but in principle
      // a concurrent close() / re-render could have replaced it. Re-read
      // and narrow at runtime to be safe.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (stage.value.kind === 'done') {
        stage.value = { ...stage.value, channelConnected: true };
      }
    }
  } catch { /* channel unavailable — skip */ }
}

function renderStage(s: ModalStage): SafeHtml {
  if (s.kind === 'completing') return <h3>Completing...</h3>;
  if (s.kind === 'failed') return renderFailed(s.message);
  return renderDone(s.result, s.aiCommand, s.channelConnected);
}

function renderFailed(message: string): SafeHtml {
  return (
    <>
      <h3>Completion Failed</h3>
      <p className="modal-label" style="color:var(--red)">{message}</p>
      <p className="modal-label">The review is unchanged — close this dialog and try again.</p>
      <div className="modal-actions">
        <button className="btn btn-sm btn-primary" {...ACTIONS.modalDone.attrs}>Close</button>
      </div>
    </>
  );
}

function renderDone(
  result: CompleteResult,
  aiCommand: string,
  channelConnected: boolean,
): SafeHtml {
  return (
    <>
      <h3>Review Completed</h3>
      <p className="modal-label">Review exported to:</p>
      <div className="modal-copyable" data-copy={result.exportPath} title="Click to copy">{result.exportPath}</div>
      <p className="modal-label">Tell your AI tool:</p>
      <div className="modal-copyable" data-copy={aiCommand} title="Click to copy">{aiCommand}</div>
      {result.hook?.ran === true && (
        result.hook.ok
          ? <p className="modal-label" style="color:var(--green)">Ran the on-complete hook</p>
          : <p className="modal-label" style="color:var(--red)">{`on-complete hook failed${result.hook.exitCode !== null ? ` (exit ${String(result.hook.exitCode)})` : ''} — see .glassbox/on-complete.log`}</p>
      )}
      <div className="modal-actions">
        {channelConnected && (
          <button className="btn btn-sm btn-primary" {...ACTIONS.sendToClaude.attrs}>Send to Claude</button>
        )}
        <button className="btn btn-sm btn-primary" {...ACTIONS.modalDone.attrs}>Done</button>
      </div>
    </>
  );
}
