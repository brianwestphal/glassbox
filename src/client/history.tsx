/** Client script for the review history page. Built separately from app.ts. */
import { delegate } from 'kerfjs';

import { asEl, toElement } from './dom.js';

function updateBulkVisibility(): void {
  const bulk = document.querySelector('.bulk-actions');
  if (bulk && !document.querySelector('.delete-review-btn')) {
    bulk.remove();
  }
}

function showConfirm(message: string, onConfirm: () => void): void {
  const overlay = toElement(
    <div className="modal-overlay">
      <div className="modal">
        <h3>Confirm</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="btn btn-sm modal-cancel">Cancel</button>
          <button className="btn btn-sm btn-danger modal-confirm">Delete</button>
        </div>
      </div>
    </div>
  );
  delegate(overlay, 'click', '.modal-cancel', () => { overlay.remove(); });
  delegate(overlay, 'click', '.modal-confirm', () => { overlay.remove(); onConfirm(); });
  // Click-outside-to-close. The overlay isn't inside a mount() tree, so a
  // direct listener is stable (same precedent as the other transient
  // confirmation modals across the app).
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// Delegate all history-page button clicks at document.body. Server-rendered
// rows + persistent bulk-action buttons all live there; no per-element
// listeners needed.

delegate(document.body, 'click', '.delete-review-btn', (e, btn) => {
  e.preventDefault();
  e.stopPropagation();
  const id = asEl(btn).dataset.deleteId ?? '';
  showConfirm('Delete this review? This cannot be undone.', () => {
    void fetch('/api/review/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(r => r.json())
      .then(() => {
        asEl(btn).closest('.history-item-link')?.parentElement?.remove();
        updateBulkVisibility();
      });
  });
});

delegate(document.body, 'click', '#delete-completed-btn', () => {
  showConfirm('Delete all completed reviews (except current)? This cannot be undone.', () => {
    void fetch('/api/reviews/delete-completed', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(r => r.json())
      .then(() => { location.reload(); });
  });
});

delegate(document.body, 'click', '#delete-all-btn', () => {
  showConfirm('Delete ALL reviews except the current one? This cannot be undone.', () => {
    void fetch('/api/reviews/delete-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(r => r.json())
      .then(() => { location.reload(); });
  });
});
