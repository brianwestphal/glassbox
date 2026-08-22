/** Client script for the review history page. Built separately from app.ts. */
import { delegate } from 'kerfjs';
import { confirm } from 'kerfjs/overlay';

import { deleteAllReviews, deleteCompletedReviews, deleteReview } from '../api/reviews.js';
import { asEl } from './dom.js';

function updateBulkVisibility(): void {
  const bulk = document.querySelector('.bulk-actions');
  if (bulk && !document.querySelector('.delete-review-btn')) {
    bulk.remove();
  }
}

/** Danger-confirm via kerfjs/overlay (native <dialog>, focus trap + restore,
 *  Escape/backdrop dismiss) — replaces a hand-rolled `.modal-overlay`. */
function confirmDelete(message: string): Promise<boolean> {
  return confirm(message, {
    title: 'Confirm', okText: 'Delete', cancelText: 'Cancel', danger: true, native: true,
  });
}

// Delegate all history-page button clicks at document.body. Server-rendered
// rows + persistent bulk-action buttons all live there; no per-element
// listeners needed.

void delegate(document.body, 'click', '.delete-review-btn', (e, btn) => {
  e.preventDefault();
  e.stopPropagation();
  const id = asEl(btn).dataset.deleteId ?? '';
  void (async () => {
    if (!(await confirmDelete('Delete this review? This cannot be undone.'))) return;
    try {
      await deleteReview({ id });
      asEl(btn).closest('.history-item-link')?.parentElement?.remove();
      updateBulkVisibility();
    } catch (err) {
      alert(`Failed to delete review: ${String(err)}`);
    }
  })();
});

void delegate(document.body, 'click', '#delete-completed-btn', () => {
  void (async () => {
    if (!(await confirmDelete('Delete all completed reviews (except current)? This cannot be undone.'))) return;
    try {
      await deleteCompletedReviews();
      location.reload();
    } catch (err) {
      alert(`Failed to delete reviews: ${String(err)}`);
    }
  })();
});

void delegate(document.body, 'click', '#delete-all-btn', () => {
  void (async () => {
    if (!(await confirmDelete('Delete ALL reviews except the current one? This cannot be undone.'))) return;
    try {
      await deleteAllReviews();
      location.reload();
    } catch (err) {
      alert(`Failed to delete reviews: ${String(err)}`);
    }
  })();
});
