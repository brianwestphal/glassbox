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
  /** Ids of files that carry AI review notes (doc 20 §20.6, GB-1136) — marked
   *  with a note icon on the initial server paint (the client refreshes it from
   *  `/api/files`). Defaults to none. */
  notedFileIds?: Set<string>;
  footer: SafeHtml;
}

/**
 * Shared layout for both the active-review root (`/`) and the historical
 * review viewer (`/review/:reviewId`). The two routes only differ in the
 * footer (Complete vs. Reopen + a "back to current review" link), so we
 * pass the footer in as a prop and keep all the shell markup in one place.
 */
export function ReviewShell({ reviewId, review, files, annotationCounts, staleCounts, notedFileIds, footer }: ReviewShellProps): SafeHtml {
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
          <FileList files={files} annotationCounts={annotationCounts} staleCounts={staleCounts} notedFileIds={notedFileIds} />
          <div className="sidebar-share" id="sidebar-share"></div>
          <div className="sidebar-footer">
            {footer}
            {/* Plugin UI extensions (doc 30 FR-30.2): sidebar-footer location. */}
            <div className="plugin-ui-slot" id="plugin-ui-sidebar-footer"></div>
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
            <button className="nav-btn" id="sidebar-toggle-btn" title="Hide sidebar" aria-pressed="false">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>
            </button>
            <button className="nav-btn disabled" id="nav-back-btn" disabled title="Back">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <button className="nav-btn disabled" id="nav-forward-btn" disabled title="Forward">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </button>
            <span className="nav-file-path" id="nav-file-path"></span>
            {/* Plugin UI extensions (doc 30 FR-30.2): header location (main-content top bar). */}
            <span className="plugin-ui-slot" id="plugin-ui-header"></span>
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
              </div>
              <div className="diff-toolbar-right">
                <button className="toolbar-btn" id="language-btn">Plain Text</button>
              </div>
            </div>
            <div className="diff-toolbar-image" style="display:none">
              <div className="diff-toolbar-left">
                <div className="segmented-control">
                  <button className="segment" data-image-mode="metadata">Metadata</button>
                  <button className="segment" data-image-mode="a" title="Show only the A (old) image">A</button>
                  <button className="segment" data-image-mode="b" title="Show only the B (new) image">B</button>
                  <button className="segment active" data-image-mode="side-by-side">Side by Side</button>
                  <button className="segment" data-image-mode="difference">Difference</button>
                  <button className="segment" data-image-mode="slice">Slice</button>
                  <button className="segment" data-image-mode="image" style="display:none">Image</button>
                </div>
                {/* Orientation sub-option, shown only while Side by Side is active (doc 24). */}
                <div className="segmented-control image-sxs-orient" data-sxs-orient-control style="display:none">
                  <button className="segment active" data-sxs-orient="left-right" title="Place the two images left and right">Left / Right</button>
                  <button className="segment" data-sxs-orient="over-under" title="Stack the two images top and bottom">Over / Under</button>
                </div>
              </div>
              <div className="diff-toolbar-right">
                <button className="image-zoom-btn" data-zoom-action="out" title="Zoom out"><IconZoomOut /></button>
                <button className="image-zoom-btn" data-zoom-action="fit" title="Fit to view"><IconFit /></button>
                <button className="image-zoom-btn" data-zoom-action="actual" title="Actual size (1:1)"><IconActualSize /></button>
                <button className="image-zoom-btn" data-zoom-action="in" title="Zoom in"><IconZoomIn /></button>
              </div>
            </div>
            {/* Plugin UI extensions (doc 30 FR-30.2): diff-toolbar location (always visible, outside the text/image sub-toolbars). */}
            <div className="plugin-ui-slot" id="plugin-ui-diff-toolbar"></div>
          </div>
        </main>
      </div>
    </div>
  );
}
