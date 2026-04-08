import { api } from '../api.js';
import { toElement } from '../dom.js';
import { renderFileList } from '../sidebar/fileTree.js';
import { state } from '../state.js';

interface CompleteResult {
  isCurrent: boolean;
  reviewId: string;
  exportPath: string;
  gitignorePrompt: boolean;
}

export function bindCompleteButton() {
  const btn = document.getElementById('complete-review');
  if (btn === null) return;
  btn.addEventListener('click', () => { showCompleteModal(); });
}

export function bindReopenButton() {
  const btn = document.getElementById('reopen-review');
  if (btn === null) return;
  btn.addEventListener('click', () => {
    void (async () => {
      await api('/review/reopen', { method: 'POST' });
      const completeBtn = toElement(
        <button className="btn btn-primary btn-complete" id="complete-review">Complete Review</button>
      );
      btn.replaceWith(completeBtn);
      bindCompleteButton();
    })();
  });
}

function showCompleteModal() {
  let totalStale = 0;
  Object.keys(state.staleCounts).forEach(k => { totalStale += (state.staleCounts[k] ?? 0); });

  const overlay = toElement(<div className="modal-overlay"></div>);

  if (totalStale > 0) {
    overlay.innerHTML = (
      <div className="modal">
        <h3>Stale Annotations</h3>
        <p>{'There ' + (totalStale === 1 ? 'is 1 stale annotation' : `are ${String(totalStale)} stale annotations`) +
          ' that could not be matched to the current diff. What would you like to do?'}</p>
        <div className="modal-actions">
          <button className="btn btn-sm modal-cancel">Cancel</button>
          <button className="btn btn-sm btn-danger" data-stale-action="discard">Discard All Stale</button>
          <button className="btn btn-sm btn-primary" data-stale-action="keep">{'Keep All & Complete'}</button>
        </div>
      </div>
    ).toString();

    overlay.querySelector('.modal-cancel')?.addEventListener('click', () => { overlay.remove(); });
    overlay.querySelector('[data-stale-action="discard"]')?.addEventListener('click', () => {
      void (async () => {
        await api('/annotations/stale/delete-all', { method: 'POST' });
        state.staleCounts = {};
        renderFileList();
        overlay.remove();
        showCompleteModal();
      })();
    });
    overlay.querySelector('[data-stale-action="keep"]')?.addEventListener('click', () => {
      void (async () => {
        await api('/annotations/stale/keep-all', { method: 'POST' });
        state.staleCounts = {};
        renderFileList();
        overlay.remove();
        showCompleteModal();
      })();
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    return;
  }

  // Skip confirmation — go directly to completion
  overlay.innerHTML = (<div className="modal"><h3>Completing...</h3></div>).toString();
  document.body.appendChild(overlay);

  void (async () => {
    const result = await api<CompleteResult>('/review/complete', { method: 'POST' });
    const aiCommand = result.isCurrent
      ? 'Read .glassbox/latest-review.md and apply the feedback.'
      : 'Read .glassbox/review-' + result.reviewId + '.md and apply the feedback.';

    const modalEl = overlay.querySelector('.modal');
    if (modalEl === null) return;
    modalEl.innerHTML = (
      <>
        <h3>Review Completed</h3>
        <p className="modal-label">Review exported to:</p>
        <div className="modal-copyable" data-copy={result.exportPath} title="Click to copy">{result.exportPath}</div>
        <p className="modal-label">Tell your AI tool:</p>
        <div className="modal-copyable" data-copy={aiCommand} title="Click to copy">{aiCommand}</div>
        {result.gitignorePrompt && (
          <div className="modal-gitignore">
            <p className="modal-label">.glassbox/ is not in your .gitignore</p>
            <div className="modal-actions" style="justify-content:flex-start;margin-top:4px">
              <button className="btn btn-sm btn-primary" id="gitignore-add">Add to .gitignore</button>
              <button className="btn btn-sm" id="gitignore-dismiss">{"Don't ask for 30 days"}</button>
            </div>
          </div>
        )}
        <div className="modal-actions" id="complete-modal-actions">
          <button className="btn btn-sm btn-primary modal-done">Done</button>
        </div>
      </>
    ).toString();

    overlay.querySelector('.modal-done')?.addEventListener('click', () => { overlay.remove(); });

    // Check channel status and add "Send to Claude" button if connected
    void (async () => {
      try {
        const channelStatus = await api<{ enabled: boolean; connected: boolean }>('/channel/status');
        if (channelStatus.enabled && channelStatus.connected) {
          const actionsDiv = overlay.querySelector('#complete-modal-actions');
          if (actionsDiv !== null) {
            const doneBtn = actionsDiv.querySelector('.modal-done');
            if (doneBtn !== null) {
              const sendBtn = toElement(
                <button className="btn btn-sm btn-primary" id="send-to-claude">Send to Claude</button>
              );
              actionsDiv.insertBefore(sendBtn, doneBtn);
              sendBtn.addEventListener('click', () => {
                void (async () => {
                  await api('/channel/trigger', { method: 'POST', body: { message: aiCommand } });
                  sendBtn.textContent = 'Sent!';
                  sendBtn.setAttribute('disabled', 'true');
                  setTimeout(() => { overlay.remove(); }, 1000);
                })();
              });
            }
          }
        }
      } catch { /* channel unavailable — skip button */ }
    })();

    overlay.querySelectorAll('.modal-copyable').forEach(el => {
      el.addEventListener('click', () => {
        const copyText = (el as HTMLElement).dataset.copy ?? '';
        void navigator.clipboard.writeText(copyText);
        el.classList.add('copied');
        setTimeout(() => { el.classList.remove('copied'); }, 1500);
      });
    });

    const addBtn = overlay.querySelector('#gitignore-add');
    if (addBtn !== null) {
      addBtn.addEventListener('click', () => {
        void (async () => {
          await api('/gitignore/add', { method: 'POST' });
          const gitignoreContainer = addBtn.closest('.modal-gitignore');
          if (gitignoreContainer !== null) {
            gitignoreContainer.innerHTML = (<p className="modal-label" style="color:var(--green)">Added .glassbox/ to .gitignore</p>).toString();
          }
        })();
      });
    }
    const dismissBtn = overlay.querySelector('#gitignore-dismiss');
    if (dismissBtn !== null) {
      dismissBtn.addEventListener('click', () => {
        void (async () => {
          await api('/gitignore/dismiss', { method: 'POST' });
          dismissBtn.closest('.modal-gitignore')?.remove();
        })();
      });
    }

    const completeBtn = document.getElementById('complete-review');
    if (completeBtn !== null) {
      const reopenBtn = toElement(
        <button className="btn btn-primary" id="reopen-review">Reopen Review</button>
      );
      completeBtn.replaceWith(reopenBtn);
      bindReopenButton();
    }
  })();
}
