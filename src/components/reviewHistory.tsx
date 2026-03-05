import type { Review } from '../db/queries.js';
import { raw } from '../jsx-runtime.js';

function titleCase(s: string): string {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const trashIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

// Shorten hex strings that look like commit SHAs (7+ hex chars)
function shortenArgs(args: string): { short: string; full: string } {
  const shaPattern = /\b([0-9a-f]{7,40})\b/gi;
  let hasLong = false;
  const short = args.replace(shaPattern, (match) => {
    if (match.length > 8) {
      hasLong = true;
      return match.slice(0, 7);
    }
    return match;
  });
  return { short, full: hasLong ? args : '' };
}

export function ReviewHistory({ reviews, currentReviewId }: { reviews: Review[]; currentReviewId: string }) {
  const hasOtherReviews = reviews.some(r => r.id !== currentReviewId);
  const hasCompletedOthers = reviews.some(r => r.id !== currentReviewId && r.status === 'completed');

  return (
    <div className="history-page">
      <h1>Review History</h1>
      {reviews.length === 0 ? (
        <p style="color:var(--text-dim)">No previous reviews found.</p>
      ) : (
        <div>
          {reviews.map(r => {
            const isCurrent = r.id === currentReviewId;
            const href = isCurrent ? '/' : `/review/${r.id}`;
            let argsDisplay = null;
            if (r.mode_args) {
              const { short, full } = shortenArgs(r.mode_args);
              argsDisplay = full
                ? <span title={full}>: {short}</span>
                : <span>: {short}</span>;
            }
            return (
              <div>
                <a href={href} className="history-item-link">
                  <div className="history-item" data-review-id={r.id}>
                    <h3>
                      {r.repo_name} - {titleCase(r.mode)}{argsDisplay}
                      {isCurrent ? <span className="status-badge in_progress" style="margin-left:8px">Current</span> : null}
                      <span className={`status-badge ${r.status}`} style="margin-left:8px">{titleCase(r.status)}</span>
                    </h3>
                    <div className="meta">
                      ID: {r.id} | Created: {r.created_at}
                    </div>
                    {!isCurrent ? (
                      <button className="delete-review-btn" data-delete-id={r.id} title="Delete review">{raw(trashIcon)}</button>
                    ) : null}
                  </div>
                </a>
                {isCurrent && hasOtherReviews ? (
                  <div className="bulk-actions">
                    <span>Bulk actions:</span>
                    {hasCompletedOthers ? (
                      <button className="btn btn-sm btn-danger" id="delete-completed-btn">Delete Completed</button>
                    ) : null}
                    <button className="btn btn-sm btn-danger" id="delete-all-btn">Delete All</button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <a href="/" className="btn btn-link" style="margin-top:16px;display:inline-block">Back to current review</a>
      <script>{raw(getHistoryScript())}</script>
    </div>
  );
}

function getHistoryScript(): string {
  return `
(function() {
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function updateBulkVisibility() {
    var bulk = document.querySelector('.bulk-actions');
    if (bulk && !document.querySelector('.delete-review-btn')) {
      bulk.remove();
    }
  }

  // Single review delete
  document.querySelectorAll('.delete-review-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var id = btn.dataset.deleteId;
      showConfirm('Delete this review? This cannot be undone.', function() {
        fetch('/api/review/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function(r) { return r.json(); })
          .then(function() {
            btn.closest('.history-item-link').parentElement.remove();
            updateBulkVisibility();
          });
      });
    });
  });

  // Bulk delete completed
  var delCompletedBtn = document.getElementById('delete-completed-btn');
  if (delCompletedBtn) {
    delCompletedBtn.addEventListener('click', function() {
      showConfirm('Delete all completed reviews (except current)? This cannot be undone.', function() {
        fetch('/api/reviews/delete-completed', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
          .then(function(r) { return r.json(); })
          .then(function() { location.reload(); });
      });
    });
  }

  // Bulk delete all
  var delAllBtn = document.getElementById('delete-all-btn');
  if (delAllBtn) {
    delAllBtn.addEventListener('click', function() {
      showConfirm('Delete ALL reviews except the current one? This cannot be undone.', function() {
        fetch('/api/reviews/delete-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
          .then(function(r) { return r.json(); })
          .then(function() { location.reload(); });
      });
    });
  }

  function showConfirm(message, onConfirm) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal">' +
        '<h3>Confirm</h3>' +
        '<p>' + esc(message) + '</p>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-sm modal-cancel">Cancel</button>' +
          '<button class="btn btn-sm btn-danger modal-confirm">Delete</button>' +
        '</div>' +
      '</div>';
    overlay.querySelector('.modal-cancel').addEventListener('click', function() { overlay.remove(); });
    overlay.querySelector('.modal-confirm').addEventListener('click', function() { overlay.remove(); onConfirm(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }
})();
`;
}
