/** Client script for the review history page. Built separately from app.ts. */

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function updateBulkVisibility() {
  const bulk = document.querySelector('.bulk-actions');
  if (bulk && !document.querySelector('.delete-review-btn')) {
    bulk.remove();
  }
}

function showConfirm(message: string, onConfirm: () => void) {
  const overlay = document.createElement('div');
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
  overlay.querySelector('.modal-cancel')!.addEventListener('click', () => { overlay.remove(); });
  overlay.querySelector('.modal-confirm')!.addEventListener('click', () => { overlay.remove(); onConfirm(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// Single review delete
document.querySelectorAll<HTMLElement>('.delete-review-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = btn.dataset.deleteId!;
    showConfirm('Delete this review? This cannot be undone.', () => {
      fetch('/api/review/' + encodeURIComponent(id), { method: 'DELETE' })
        .then(r => r.json())
        .then(() => {
          btn.closest('.history-item-link')?.parentElement?.remove();
          updateBulkVisibility();
        });
    });
  });
});

// Bulk delete completed
document.getElementById('delete-completed-btn')?.addEventListener('click', () => {
  showConfirm('Delete all completed reviews (except current)? This cannot be undone.', () => {
    fetch('/api/reviews/delete-completed', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(r => r.json())
      .then(() => { location.reload(); });
  });
});

// Bulk delete all
document.getElementById('delete-all-btn')?.addEventListener('click', () => {
  showConfirm('Delete ALL reviews except the current one? This cannot be undone.', () => {
    fetch('/api/reviews/delete-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(r => r.json())
      .then(() => { location.reload(); });
  });
});
