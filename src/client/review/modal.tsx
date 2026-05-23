import type { SafeHtml } from 'kerfjs';
import { attr, delegate, mount, signal } from 'kerfjs';

import {
  addGitignoreEntry,
  completeReview as apiCompleteReview,
  deleteStaleAnnotations,
  dismissGitignorePrompt,
  getChannelStatus,
  keepAllStaleAnnotations,
  reopenReview,
  triggerChannel,
} from '../../api/index.js';
import { asButton, asEl, toElement } from '../dom.js';
import { reviewStore } from '../stores/index.js';
import { TOAST_DURATION_MS } from '../timing.js';

const ACTIONS = {
  cancelComplete: attr('data-action', 'cancel-complete'),
  modalDone: attr('data-action', 'modal-done'),
  discardStale: attr('data-action', 'discard-stale'),
  keepStale: attr('data-action', 'keep-stale'),
  gitignoreAdd: attr('data-action', 'gitignore-add'),
  gitignoreDismiss: attr('data-action', 'gitignore-dismiss'),
  sendToClaude: attr('data-action', 'send-to-claude'),
} as const;

interface CompleteResult {
  isCurrent: boolean;
  reviewId: string;
  exportPath: string;
  gitignorePrompt: boolean;
}

type ModalStage =
  | { kind: 'stale-prompt'; totalStale: number }
  | { kind: 'completing' }
  | {
      kind: 'done';
      result: CompleteResult;
      aiCommand: string;
      channelConnected: boolean;
      gitignoreApplied: 'pending' | 'added' | 'dismissed';
    };

export function bindCompleteButton(): void {
  const root = document.querySelector<HTMLElement>('.review-app') ?? document.body;
  delegate(root, 'click', '#complete-review', () => { showCompleteModal(); });
}

export function bindReopenButton(): void {
  const root = document.querySelector<HTMLElement>('.review-app') ?? document.body;
  delegate(root, 'click', '#reopen-review', (_e, btn) => {
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

  const stage = signal<ModalStage>(
    totalStale > 0 ? { kind: 'stale-prompt', totalStale } : { kind: 'completing' },
  );

  const overlay = toElement(<div className="modal-overlay"><div className="modal"></div></div>);
  const modalEl = overlay.querySelector<HTMLElement>('.modal');
  if (modalEl === null) return;

  let disposeMount: (() => void) | null = null;
  function close(): void {
    if (disposeMount !== null) disposeMount();
    overlay.remove();
  }

  disposeMount = mount(modalEl, () => renderStage(stage.value));

  // Delegated handlers on the overlay — fire once per click regardless of
  // which stage we're in, since the data-action attribute identifies the
  // intent.

  delegate(overlay, 'click', ACTIONS.cancelComplete.selector, close);
  delegate(overlay, 'click', ACTIONS.modalDone.selector, close);

  delegate(overlay, 'click', ACTIONS.discardStale.selector, () => {
    void (async () => {
      await deleteStaleAnnotations();
      reviewStore.actions.update({ staleCounts: {} });
      stage.value = { kind: 'completing' };
      void completeReview(stage);
    })();
  });
  delegate(overlay, 'click', ACTIONS.keepStale.selector, () => {
    void (async () => {
      await keepAllStaleAnnotations();
      reviewStore.actions.update({ staleCounts: {} });
      stage.value = { kind: 'completing' };
      void completeReview(stage);
    })();
  });

  delegate(overlay, 'click', '.modal-copyable', (_e, el) => {
    const copyText = asEl(el).dataset.copy ?? '';
    void navigator.clipboard.writeText(copyText);
    asEl(el).classList.add('copied');
    setTimeout(() => { asEl(el).classList.remove('copied'); }, TOAST_DURATION_MS);
  });

  delegate(overlay, 'click', ACTIONS.gitignoreAdd.selector, () => {
    void (async () => {
      await addGitignoreEntry();
      if (stage.value.kind === 'done') {
        stage.value = { ...stage.value, gitignoreApplied: 'added' };
      }
    })();
  });
  delegate(overlay, 'click', ACTIONS.gitignoreDismiss.selector, () => {
    void (async () => {
      await dismissGitignorePrompt();
      if (stage.value.kind === 'done') {
        stage.value = { ...stage.value, gitignoreApplied: 'dismissed' };
      }
    })();
  });

  delegate(overlay, 'click', ACTIONS.sendToClaude.selector, (_e, btn) => {
    if (stage.value.kind !== 'done') return;
    const aiCommand = stage.value.aiCommand;
    const sendBtn = asButton(btn);
    void (async () => {
      await triggerChannel({ message: aiCommand });
      sendBtn.textContent = 'Sent!';
      sendBtn.setAttribute('disabled', 'true');
      setTimeout(() => { close(); }, 1000);
    })();
  });

  // Click outside → close. Direct listener on overlay (not in a mount tree).
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.body.appendChild(overlay);

  // Kick off the API call if we're past the stale prompt.
  if (stage.value.kind === 'completing') void completeReview(stage);
}

async function completeReview(stage: ReturnType<typeof signal<ModalStage>>): Promise<void> {
  const result = await apiCompleteReview();
  const aiCommand = result.isCurrent
    ? 'Read .glassbox/latest-review.md and apply the feedback.'
    : 'Read .glassbox/review-' + result.reviewId + '.md and apply the feedback.';

  // Default to disconnected; we'll update once we know.
  stage.value = { kind: 'done', result, aiCommand, channelConnected: false, gitignoreApplied: 'pending' };

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
  if (s.kind === 'stale-prompt') return renderStalePrompt(s.totalStale);
  if (s.kind === 'completing') return <h3>Completing...</h3>;
  return renderDone(s.result, s.aiCommand, s.channelConnected, s.gitignoreApplied);
}

function renderStalePrompt(totalStale: number): SafeHtml {
  const message = 'There ' + (totalStale === 1
    ? 'is 1 stale annotation'
    : `are ${String(totalStale)} stale annotations`) +
    ' that could not be matched to the current diff. What would you like to do?';
  return (
    <>
      <h3>Stale Annotations</h3>
      <p>{message}</p>
      <div className="modal-actions">
        <button className="btn btn-sm" {...ACTIONS.cancelComplete.attrs}>Cancel</button>
        <button className="btn btn-sm btn-danger" {...ACTIONS.discardStale.attrs}>Discard All Stale</button>
        <button className="btn btn-sm btn-primary" {...ACTIONS.keepStale.attrs}>{'Keep All & Complete'}</button>
      </div>
    </>
  );
}

function renderDone(
  result: CompleteResult,
  aiCommand: string,
  channelConnected: boolean,
  gitignoreApplied: 'pending' | 'added' | 'dismissed',
): SafeHtml {
  return (
    <>
      <h3>Review Completed</h3>
      <p className="modal-label">Review exported to:</p>
      <div className="modal-copyable" data-copy={result.exportPath} title="Click to copy">{result.exportPath}</div>
      <p className="modal-label">Tell your AI tool:</p>
      <div className="modal-copyable" data-copy={aiCommand} title="Click to copy">{aiCommand}</div>
      {result.gitignorePrompt && gitignoreApplied === 'pending' && (
        <div className="modal-gitignore">
          <p className="modal-label">.glassbox/ is not in your .gitignore</p>
          <div className="modal-actions" style="justify-content:flex-start;margin-top:4px">
            <button className="btn btn-sm btn-primary" {...ACTIONS.gitignoreAdd.attrs}>Add to .gitignore</button>
            <button className="btn btn-sm" {...ACTIONS.gitignoreDismiss.attrs}>{"Don't ask for 30 days"}</button>
          </div>
        </div>
      )}
      {gitignoreApplied === 'added' && (
        <div className="modal-gitignore">
          <p className="modal-label" style="color:var(--green)">Added .glassbox/ to .gitignore</p>
        </div>
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
