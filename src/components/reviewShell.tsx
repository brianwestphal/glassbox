import type { SafeHtml } from 'kerfjs';

import type { Review, ReviewFile } from '../db/queries.js';
import { IconActualSize, IconFit, IconZoomIn, IconZoomOut } from '../icons.js';
import { formatReviewMode } from '../utils/formatReviewMode.js';
import { FileList } from './fileList.js';

interface ReviewShellProps {
  reviewId: string;
  review: Review;
  files: ReviewFile[];
  annotationCounts: Record<string, number>;
  staleCounts: Record<string, number>;
  footer: SafeHtml;
}

/**
 * Shared layout for both the active-review root (`/`) and the historical
 * review viewer (`/review/:reviewId`). The two routes only differ in the
 * footer (Complete vs. Reopen + a "back to current review" link), so we
 * pass the footer in as a prop and keep all the shell markup in one place.
 */
export function ReviewShell({ reviewId, review, files, annotationCounts, staleCounts, footer }: ReviewShellProps): SafeHtml {
  return (
    <div className="review-app" data-review-id={reviewId}>
      <div id="update-banner" className="update-banner" style="display:none">
        <span id="update-banner-label">Update available</span>
        <div className="update-banner-actions">
          <button id="update-install-btn" className="btn btn-sm btn-accent">Install Update</button>
          <button id="update-banner-dismiss" className="btn btn-sm">Later</button>
        </div>
      </div>
      <div className="review-body">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>{review.repo_name}</h2>
            <span className="review-mode">{formatReviewMode(review.mode, review.mode_args)}</span>
          </div>
          <div className="file-filter">
            <input type="text" className="file-filter-input" id="file-filter" placeholder="Filter files..." />
          </div>
          <FileList files={files} annotationCounts={annotationCounts} staleCounts={staleCounts} />
          <div className="sidebar-share" id="sidebar-share"></div>
          <div className="sidebar-footer">
            {footer}
          </div>
        </aside>
        <div className="sidebar-resize" id="sidebar-resize"></div>
        <main className="main-content">
          <div className="welcome-message">
            <h3>Select a file to begin reviewing</h3>
            <p>{files.length} file(s) to review</p>
            <p className="progress-summary" id="progress-summary"></p>
          </div>
          <div className="diff-nav-bar" id="diff-nav-bar" style="display:none">
            <button className="nav-btn disabled" id="nav-back-btn" disabled title="Back">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <button className="nav-btn disabled" id="nav-forward-btn" disabled title="Forward">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </button>
            <span className="nav-file-path" id="nav-file-path"></span>
          </div>
          <div className="diff-container" id="diff-container" style="display:none"></div>
          <div className="diff-toolbar" id="diff-toolbar" style="display:none">
            <div className="diff-toolbar-svg-toggle" style="display:none">
              <div className="segmented-control">
                <button className="segment active" data-svg-mode="code">Code</button>
                <button className="segment" data-svg-mode="rendered">Rendered</button>
              </div>
            </div>
            <div className="diff-toolbar-text">
              <div className="diff-toolbar-left">
                <div className="segmented-control">
                  <button className="segment active" data-diff-mode="split">Split</button>
                  <button className="segment" data-diff-mode="unified">Unified</button>
                </div>
                <button className="toolbar-btn" id="wrap-toggle">Wrap</button>
                <button className="toolbar-btn" id="whitespace-toggle">Ignore Whitespace</button>
                {/* GB-844: scope filters — hide non-matching diff rows via a
                    class on `#diff-container`. CSS-only; no server change. */}
                <div className="segmented-control diff-toolbar-scope">
                  <button className="segment active" data-scope-filter="all" title="Show all lines">All</button>
                  <button className="segment" data-scope-filter="adds" title="Show only added lines">Adds</button>
                  <button className="segment" data-scope-filter="removes" title="Show only removed lines">Removes</button>
                  <button className="segment" data-scope-filter="changed" title="Show only changed lines (hide context)">Changed</button>
                </div>
              </div>
              <div className="diff-toolbar-right">
                <button className="toolbar-btn" id="language-btn">Plain Text</button>
              </div>
            </div>
            <div className="diff-toolbar-image" style="display:none">
              <div className="diff-toolbar-left">
                <div className="segmented-control">
                  <button className="segment active" data-image-mode="metadata">Metadata</button>
                  <button className="segment" data-image-mode="difference">Difference</button>
                  <button className="segment" data-image-mode="slice">Slice</button>
                  <button className="segment" data-image-mode="image" style="display:none">Image</button>
                </div>
              </div>
              <div className="diff-toolbar-right">
                <button className="image-zoom-btn" data-zoom-action="out" title="Zoom out"><IconZoomOut /></button>
                <button className="image-zoom-btn" data-zoom-action="fit" title="Fit to view"><IconFit /></button>
                <button className="image-zoom-btn" data-zoom-action="actual" title="Actual size (1:1)"><IconActualSize /></button>
                <button className="image-zoom-btn" data-zoom-action="in" title="Zoom in"><IconZoomIn /></button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
