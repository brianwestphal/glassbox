import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { getReview, getReviewFiles, getReviewFile, getAnnotationsForFile, getAnnotationsForReview, listReviews } from '../db/queries.js';
import type { FileDiff } from '../git/diff.js';
import { Layout } from '../components/layout.js';
import { FileList } from '../components/fileList.js';
import { DiffView } from '../components/diffView.js';
import { ReviewHistory } from '../components/reviewHistory.js';

export const pageRoutes = new Hono<AppEnv>();

pageRoutes.get('/', async (c) => {
  const reviewId = c.get('reviewId') as string;
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
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>{review.repo_name}</h2>
            <span className="review-mode">{review.mode}{review.mode_args ? `: ${review.mode_args}` : ''}</span>
          </div>
          <div className="sidebar-controls">
            <div className="sidebar-controls-row">
              <div className="diff-mode-toggle">
                <button className="btn btn-sm active" data-diff-mode="split">Split</button>
                <button className="btn btn-sm" data-diff-mode="unified">Unified</button>
              </div>
              <span className="controls-divider"></span>
              <button className="btn btn-sm" id="wrap-toggle">Wrap</button>
            </div>
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
        </main>
      </div>
    </Layout>
  );

  return c.html(html.toString());
});

pageRoutes.get('/file/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
  const mode = (c.req.query('mode') === 'unified' ? 'unified' : 'split') as 'split' | 'unified';
  const file = await getReviewFile(fileId);
  if (!file) return c.text('File not found', 404);

  const annotations = await getAnnotationsForFile(fileId);
  const diff: FileDiff = JSON.parse(file.diff_data || '{}');

  const html = <DiffView file={file} diff={diff} annotations={annotations} mode={mode} />;
  return c.html(html.toString());
});

pageRoutes.get('/review/:reviewId', async (c) => {
  const reviewId = c.req.param('reviewId');
  const currentReviewId = c.get('reviewId') as string;

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
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>{review.repo_name}</h2>
            <span className="review-mode">{review.mode}{review.mode_args ? `: ${review.mode_args}` : ''}</span>
          </div>
          <div className="sidebar-controls">
            <div className="sidebar-controls-row">
              <div className="diff-mode-toggle">
                <button className="btn btn-sm active" data-diff-mode="split">Split</button>
                <button className="btn btn-sm" data-diff-mode="unified">Unified</button>
              </div>
              <span className="controls-divider"></span>
              <button className="btn btn-sm" id="wrap-toggle">Wrap</button>
            </div>
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
        </main>
      </div>
    </Layout>
  );

  return c.html(html.toString());
});

pageRoutes.get('/history', async (c) => {
  const repoRoot = c.get('repoRoot') as string;
  const currentReviewId = c.get('reviewId') as string;
  const reviews = await listReviews(repoRoot);

  const html = (
    <Layout title="Review History" reviewId="">
      <ReviewHistory reviews={reviews} currentReviewId={currentReviewId} />
    </Layout>
  );

  return c.html(html.toString());
});
