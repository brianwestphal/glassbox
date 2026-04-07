import { readFileSync } from 'fs';
import { Hono } from 'hono';
import { resolve } from 'path';

import { DiffView } from '../components/diffView.js';
import { FileList } from '../components/fileList.js';
import { ImageDiff } from '../components/imageDiff.js';
import { Layout } from '../components/layout.js';
import { ReviewHistory } from '../components/reviewHistory.js';
import type { ReviewFile } from '../db/queries.js';
import { getAnnotationsForFile, getReview, getReviewFile, getReviewFiles, listReviews } from '../db/queries.js';
import type { FileDiff } from '../git/diff.js';
import { getSingleFileDiff, parseModeString } from '../git/diff.js';
import { getNewImage, getOldImage,isSvgFile  } from '../git/image.js';
import { parseSvgDimensions, svgUsesExternalFonts } from '../git/svg-rasterize.js';
import { IconActualSize, IconFit, IconReveal, IconZoomIn, IconZoomOut } from '../icons.js';
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
          <div className="sidebar-share" id="sidebar-share"></div>
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
            <button className="reveal-btn" data-file-id={file.id} title="Reveal in file manager"><IconReveal /></button>
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

// View a raw repo file (not in the diff) — used by go-to-definition for non-diff files
pageRoutes.get('/file-raw', (c) => {
  const filePath = c.req.query('path');
  if (filePath === undefined || filePath === '') return c.text('Missing path', 400);
  const repoRoot = c.get('repoRoot');

  let content: string;
  try {
    content = readFileSync(resolve(repoRoot, filePath), 'utf-8');
  } catch {
    return c.text('File not found', 404);
  }

  const lines = content.split('\n');
  const diff: FileDiff = {
    filePath,
    oldPath: null,
    status: 'added',
    isBinary: false,
    hunks: [{
      oldStart: 0, oldCount: 0,
      newStart: 1, newCount: lines.length,
      lines: lines.map((line, i) => ({
        type: 'context' as const,
        oldNum: i + 1,
        newNum: i + 1,
        content: line,
      })),
    }],
  };

  const fakeFile: ReviewFile = { id: '', review_id: '', file_path: filePath, status: 'reviewed', diff_data: null, created_at: '' };
  const html = <DiffView file={fakeFile} diff={diff} annotations={[]} mode="unified" />;
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
          <div className="sidebar-share" id="sidebar-share"></div>
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
