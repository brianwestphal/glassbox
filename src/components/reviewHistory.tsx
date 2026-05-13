import type { Review } from '../db/queries.js';
import { IconTrash16 } from '../icons.js';

function titleCase(s: string): string {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Shorten hex strings that look like commit SHAs (7+ hex chars)
function shortenArgs(args: string): { short: string; full: string } {
  const shaPattern = /\b([0-9a-f]{7,40})\b/gi;
  const result: { hasLong: boolean } = { hasLong: false };
  const short = args.replace(shaPattern, (match) => {
    if (match.length > 8) {
      result.hasLong = true;
      return match.slice(0, 7);
    }
    return match;
  });
  return { short, full: result.hasLong ? args : '' };
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
            if (r.mode_args !== null && r.mode_args !== '') {
              const { short, full } = shortenArgs(r.mode_args);
              argsDisplay = full !== ''
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
                      ID: {r.id} | Created: {/* The `Review` type says `created_at: string`, but PGLite
                        actually returns a `Date` from `timestamp` columns at
                        runtime, which the kerf JSX runtime rejects. The
                        explicit String() coercion is intentional. */
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion
                        String(r.created_at)}
                    </div>
                    {!isCurrent ? (
                      <button className="delete-review-btn" data-delete-id={r.id} title="Delete review"><IconTrash16 /></button>
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
      <script src="/static/history.js"></script>
    </div>
  );
}
