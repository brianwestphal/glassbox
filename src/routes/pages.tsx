import { readFileSync } from 'fs';
import { Hono } from 'hono';
import { resolve } from 'path';

import { DiffView } from '../components/diffView.js';
import { ImageDiff } from '../components/imageDiff.js';
import { Layout } from '../components/layout.js';
import { ReviewHistory } from '../components/reviewHistory.js';
import { ReviewShell } from '../components/reviewShell.js';
import type { ReviewFile } from '../db/queries.js';
import { getAnnotationCountsForReview, getAnnotationsForFile, getReview, getReviewFile, getReviewFiles, listReviews } from '../db/queries.js';
import { getDemoMode } from '../debug.js';
import { demoReviewNotes } from '../demo.js';
import type { FileDiff } from '../git/diff.js';
import { getSingleFileDiff, parseDiffData, parseModeString } from '../git/diff.js';
import { getNewImage, getOldImage,isSvgFile  } from '../git/image.js';
import { emptyFileDiff } from '../git/parseDiffData.js';
import { parseSvgDimensions, svgUsesExternalFonts } from '../git/svg-meta.js';
import { IconReveal } from '../icons.js';
import { reanchorReviewNotes } from '../review-notes/reanchor.js';
import { loadReviewNotesForFile } from '../review-notes/store.js';
import type { AppEnv } from '../types.js';

export const pageRoutes = new Hono<AppEnv>();

pageRoutes.get('/', async (c) => {
  const reviewId = c.get('reviewId');
  const review = await getReview(reviewId);
  if (!review) return c.text('Review not found', 404);

  const [files, annotationCounts] = await Promise.all([
    getReviewFiles(reviewId),
    getAnnotationCountsForReview(reviewId),
  ]);

  // A difftool session (doc 19) is a transient viewing session, not a tracked
  // review to export: it offers a session-ending "Done" instead of "Complete".
  const isDifftool = review.mode === 'difftool';
  const footer = isDifftool ? (
    <>
      <button className="btn btn-primary" id="difftool-done">Done</button>
    </>
  ) : (
    <>
      <button className="btn btn-primary btn-complete" id="complete-review">Complete Review</button>
      <a href="/history" className="btn btn-sm btn-link">Review History</a>
    </>
  );

  const html = (
    <Layout title={`Glassbox - ${review.repo_name}`} reviewId={reviewId} difftool={isDifftool}>
      <ReviewShell reviewId={reviewId} review={review} files={files} annotationCounts={annotationCounts} staleCounts={{}} footer={footer} />
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

  const diff: FileDiff = parseDiffData(file.diff_data) ?? emptyFileDiff(file.file_path);

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

  // AI-authored review notes from `.pr-notes/` (docs/20 P2). Demo mode has no
  // on-disk notes, so it serves a small illustrative set instead. Re-anchor them
  // against the current diff so a note whose line shifted lands correctly and a
  // note whose text is gone is flagged stale (docs/20 §20.3 P3).
  const rawNotes = getDemoMode() !== null
    ? demoReviewNotes(file.file_path)
    : loadReviewNotesForFile(c.get('repoRoot'), file.file_path);
  const reviewNotes = reanchorReviewNotes(rawNotes, finalDiff);

  const html = <DiffView file={file} diff={finalDiff} annotations={annotations} mode={mode} reviewNotes={reviewNotes} />;
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

  const fakeFile: ReviewFile = { id: '', review_id: '', file_path: filePath, status: 'reviewed', diff_data: null, difference_score: null, created_at: '' };
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

  const [files, annotationCounts] = await Promise.all([
    getReviewFiles(reviewId),
    getAnnotationCountsForReview(reviewId),
  ]);

  const footer = (
    <>
      {review.status === 'completed' ? (
        <button className="btn btn-primary" id="reopen-review">Reopen Review</button>
      ) : (
        <button className="btn btn-primary btn-complete" id="complete-review">Complete Review</button>
      )}
      <a href="/history" className="btn btn-sm btn-link">Review History</a>
      <a href="/" className="btn btn-sm btn-link">Back to current review</a>
    </>
  );

  const html = (
    <Layout title={`Glassbox - ${review.repo_name}`} reviewId={reviewId}>
      <ReviewShell reviewId={reviewId} review={review} files={files} annotationCounts={annotationCounts} staleCounts={{}} footer={footer} />
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
