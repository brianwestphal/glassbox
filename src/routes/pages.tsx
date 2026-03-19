import { Hono } from 'hono';

import { DiffView } from '../components/diffView.js';
import { FileList } from '../components/fileList.js';
import { ImageDiff } from '../components/imageDiff.js';
import { Layout } from '../components/layout.js';
import { ReviewHistory } from '../components/reviewHistory.js';
import { getAnnotationsForFile, getReview, getReviewFile, getReviewFiles, listReviews } from '../db/queries.js';
import type { FileDiff } from '../git/diff.js';
import { getSingleFileDiff, parseModeString } from '../git/diff.js';
import { isSvgFile } from '../git/image.js';
import { getNewImage, getOldImage } from '../git/image.js';
import { parseSvgDimensions, svgUsesExternalFonts } from '../git/svg-rasterize.js';
import { raw } from '../jsx-runtime.js';
import type { AppEnv } from '../types.js';

const zoomOutSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const zoomInSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const actualSizeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><text x="12" y="15.5" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor" stroke="none">1:1</text></svg>';
const fitSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
const revealSvgIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 11 15 14"/></svg>';

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
        <div className="review-body">
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
                  <button className="segment active" data-image-mode="metadata">Metadata</button>
                  <button className="segment" data-image-mode="difference">Difference</button>
                  <button className="segment" data-image-mode="slice">Slice</button>
                  <button className="segment" data-image-mode="image" style="display:none">Image</button>
                </div>
              </div>
              <div className="diff-toolbar-right">
                <button className="image-zoom-btn" data-zoom-action="out" title="Zoom out">{raw(zoomOutSvg)}</button>
                <button className="image-zoom-btn" data-zoom-action="fit" title="Fit to view">{raw(fitSvg)}</button>
                <button className="image-zoom-btn" data-zoom-action="actual" title="Actual size (1:1)">{raw(actualSizeSvg)}</button>
                <button className="image-zoom-btn" data-zoom-action="in" title="Zoom in">{raw(zoomInSvg)}</button>
              </div>
            </div>
          </div>
        </main>
        </div>
      </div>
    </Layout>
  );

  return c.html(html.toString());
});

pageRoutes.get('/file/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
  const mode = (c.req.query('mode') === 'unified' ? 'unified' : 'split');
  const ignoreWhitespace = c.req.query('ignoreWhitespace') === '1';
  const view = c.req.query('view');
  const file = await getReviewFile(fileId);
  if (!file) return c.text('File not found', 404);

  const diff: FileDiff = JSON.parse(file.diff_data ?? '{}') as FileDiff;

  // SVG rendered view: return ImageDiff component
  if (view === 'rendered' && isSvgFile(file.file_path)) {
    const repoRoot = c.get('repoRoot');
    const review = await getReview(file.review_id);
    let fontWarning = false;
    let svgBaseWidth = 300;
    let svgBaseHeight = 150;
    if (review) {
      const reviewMode = parseModeString(review.mode);
      const oldImg = diff.status !== 'added' ? getOldImage(reviewMode, file.file_path, diff.oldPath ?? null, repoRoot) : null;
      const newImg = diff.status !== 'deleted' ? getNewImage(reviewMode, file.file_path, repoRoot) : null;
      // Use the new-side SVG for dimensions (or old-side for deletions)
      const svgData = newImg ?? oldImg;
      if (svgData) {
        const dims = parseSvgDimensions(svgData.data.toString('utf-8'));
        svgBaseWidth = dims.width;
        svgBaseHeight = dims.height;
      }
      if ((oldImg && svgUsesExternalFonts(oldImg.data)) || (newImg && svgUsesExternalFonts(newImg.data))) {
        fontWarning = true;
      }
    }

    const html = (
      <div className="diff-view" data-file-id={file.id} data-file-path={file.file_path} data-is-svg="true">
        <div className="diff-header">
          <div className="diff-header-file">
            <span className="file-path">{diff.filePath}</span>
            <button className="reveal-btn" data-file-id={file.id} title="Reveal in file manager">{raw(revealSvgIcon)}</button>
          </div>
          <div className="diff-header-actions">
            <span className={`file-status ${diff.status}`}>{diff.status}</span>
          </div>
        </div>
        <ImageDiff file={file} diff={diff} fontWarning={fontWarning}
          baseWidth={svgBaseWidth} baseHeight={svgBaseHeight} />
      </div>
    );
    return c.html(html.toString());
  }

  // Normal text diff view
  const annotations = await getAnnotationsForFile(fileId);
  let finalDiff = diff;

  if (ignoreWhitespace) {
    const repoRoot = c.get('repoRoot');
    const review = await getReview(file.review_id);
    if (review) {
      const reviewMode = parseModeString(review.mode);
      const regenerated = getSingleFileDiff(reviewMode, file.file_path, repoRoot, '-w');
      if (regenerated) {
        finalDiff = regenerated;
      }
    }
  }

  const html = <DiffView file={file} diff={finalDiff} annotations={annotations} mode={mode} />;
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
        <div className="review-body">
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
                  <button className="segment active" data-image-mode="metadata">Metadata</button>
                  <button className="segment" data-image-mode="difference">Difference</button>
                  <button className="segment" data-image-mode="slice">Slice</button>
                  <button className="segment" data-image-mode="image" style="display:none">Image</button>
                </div>
              </div>
              <div className="diff-toolbar-right">
                <button className="image-zoom-btn" data-zoom-action="out" title="Zoom out">{raw(zoomOutSvg)}</button>
                <button className="image-zoom-btn" data-zoom-action="fit" title="Fit to view">{raw(fitSvg)}</button>
                <button className="image-zoom-btn" data-zoom-action="actual" title="Actual size (1:1)">{raw(actualSizeSvg)}</button>
                <button className="image-zoom-btn" data-zoom-action="in" title="Zoom in">{raw(zoomInSvg)}</button>
              </div>
            </div>
          </div>
        </main>
        </div>
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
