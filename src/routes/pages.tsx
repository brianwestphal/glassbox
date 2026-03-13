import { Hono } from 'hono';

import { DiffView } from '../components/diffView.js';
import { FileList } from '../components/fileList.js';
import { Layout } from '../components/layout.js';
import { ReviewHistory } from '../components/reviewHistory.js';
import { getAnnotationsForFile, getReview, getReviewFile, getReviewFiles, listReviews } from '../db/queries.js';
import type { FileDiff } from '../git/diff.js';
import type { AppEnv } from '../types.js';

export const pageRoutes = new Hono<AppEnv>();

pageRoutes.get('/', async (c) => {
  const reviewId = c.get('reviewId');
  const review = await getReview(reviewId);
  if (!review) return c.text('Review not found', 404);

  const files = await getReviewFiles(reviewId);
  const annotationCounts: Record<string, number> = {};
  for (const f of files) {
    const anns = await getAnnotationsForFile(f.id);
    annotationCounts[f.id] = anns.length;
  }

  const html = (
    <Layout title={`Glassbox - ${review.repo_name}`} reviewId={reviewId}>
      <div className="review-app" data-review-id={reviewId}>
        <div id="update-banner" className="update-banner" style="display:none">
          <span id="update-banner-label">Update available</span>
          <div className="update-banner-actions">
            <button id="update-install-btn" className="btn btn-sm btn-accent">Install Update</button>
            <button id="update-banner-dismiss" className="btn btn-sm">Later</button>
          </div>
        </div>
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>{review.repo_name}</h2>
            <span className="review-mode">{review.mode}{review.mode_args !== null && review.mode_args !== '' ? `: ${review.mode_args}` : ''}</span>
          </div>
          <div className="file-filter">
            <input type="text" className="file-filter-input" id="file-filter" placeholder="Filter files..." />
          </div>
          <FileList files={files} annotationCounts={annotationCounts} staleCounts={{}} />
          <div className="sidebar-footer">
            <button className="btn btn-primary btn-complete" id="complete-review">Complete Review</button>
            <a href="/history" className="btn btn-sm btn-link">Review History</a>
          </div>
        </aside>
        <div className="sidebar-resize" id="sidebar-resize"></div>
        <main className="main-content">
          <div className="welcome-message">
            <h3>Select a file to begin reviewing</h3>
            <p>{files.length} file(s) to review</p>
            <p className="progress-summary" id="progress-summary"></p>
          </div>
          <div className="diff-container" id="diff-container" style="display:none"></div>
          <div className="diff-toolbar" id="diff-toolbar" style="display:none">
            <div className="diff-toolbar-left">
              <div className="segmented-control">
                <button className="segment active" data-diff-mode="split">Split</button>
                <button className="segment" data-diff-mode="unified">Unified</button>
              </div>
              <button className="toolbar-btn" id="wrap-toggle">Wrap</button>
            </div>
            <div className="diff-toolbar-right">
              <button className="toolbar-btn" id="language-btn">Plain Text</button>
            </div>
          </div>
        </main>
      </div>
    </Layout>
  );

  return c.html(html.toString());
});

pageRoutes.get('/file/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
  const mode = (c.req.query('mode') === 'unified' ? 'unified' : 'split');
  const file = await getReviewFile(fileId);
  if (!file) return c.text('File not found', 404);

  const annotations = await getAnnotationsForFile(fileId);
  const diff: FileDiff = JSON.parse(file.diff_data ?? '{}') as FileDiff;

  const html = <DiffView file={file} diff={diff} annotations={annotations} mode={mode} />;
  return c.html(html.toString());
});

pageRoutes.get('/review/:reviewId', async (c) => {
  const reviewId = c.req.param('reviewId');
  const currentReviewId = c.get('reviewId');

  // If viewing the current review, redirect to /
  if (reviewId === currentReviewId) {
    return c.redirect('/');
  }

  const review = await getReview(reviewId);
  if (!review) return c.text('Review not found', 404);

  const files = await getReviewFiles(reviewId);
  const annotationCounts: Record<string, number> = {};
  for (const f of files) {
    const anns = await getAnnotationsForFile(f.id);
    annotationCounts[f.id] = anns.length;
  }

  const html = (
    <Layout title={`Glassbox - ${review.repo_name}`} reviewId={reviewId}>
      <div className="review-app" data-review-id={reviewId}>
        <div id="update-banner" className="update-banner" style="display:none">
          <span id="update-banner-label">Update available</span>
          <div className="update-banner-actions">
            <button id="update-install-btn" className="btn btn-sm btn-accent">Install Update</button>
            <button id="update-banner-dismiss" className="btn btn-sm">Later</button>
          </div>
        </div>
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>{review.repo_name}</h2>
            <span className="review-mode">{review.mode}{review.mode_args !== null && review.mode_args !== '' ? `: ${review.mode_args}` : ''}</span>
          </div>
          <div className="file-filter">
            <input type="text" className="file-filter-input" id="file-filter" placeholder="Filter files..." />
          </div>
          <FileList files={files} annotationCounts={annotationCounts} staleCounts={{}} />
          <div className="sidebar-footer">
            {review.status === 'completed' ? (
              <button className="btn btn-primary" id="reopen-review">Reopen Review</button>
            ) : (
              <button className="btn btn-primary btn-complete" id="complete-review">Complete Review</button>
            )}
            <a href="/history" className="btn btn-sm btn-link">Review History</a>
            <a href="/" className="btn btn-sm btn-link">Back to current review</a>
          </div>
        </aside>
        <div className="sidebar-resize" id="sidebar-resize"></div>
        <main className="main-content">
          <div className="welcome-message">
            <h3>Select a file to begin reviewing</h3>
            <p>{files.length} file(s) to review</p>
            <p className="progress-summary" id="progress-summary"></p>
          </div>
          <div className="diff-container" id="diff-container" style="display:none"></div>
          <div className="diff-toolbar" id="diff-toolbar" style="display:none">
            <div className="diff-toolbar-left">
              <div className="segmented-control">
                <button className="segment active" data-diff-mode="split">Split</button>
                <button className="segment" data-diff-mode="unified">Unified</button>
              </div>
              <button className="toolbar-btn" id="wrap-toggle">Wrap</button>
            </div>
            <div className="diff-toolbar-right">
              <button className="toolbar-btn" id="language-btn">Plain Text</button>
            </div>
          </div>
        </main>
      </div>
    </Layout>
  );

  return c.html(html.toString());
});

pageRoutes.get('/history', async (c) => {
  const repoRoot = c.get('repoRoot');
  const currentReviewId = c.get('reviewId');
  const reviews = await listReviews(repoRoot);

  const html = (
    <Layout title="Review History" reviewId="">
      <ReviewHistory reviews={reviews} currentReviewId={currentReviewId} />
    </Layout>
  );

  return c.html(html.toString());
});
