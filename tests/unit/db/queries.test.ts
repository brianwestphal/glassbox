import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDb, teardownTestDb } from '../../helpers/db.js';

import { getDb } from '../../../src/db/connection.js';

// vi.mock must come before imports of the modules being tested
vi.mock('../../../src/db/connection.js', () => ({
  getDb: vi.fn(),
}));

import {
  createReview,
  getReview,
  listReviews,
  updateReviewStatus,
  updateReviewHead,
  deleteReview,
  getLatestInProgressReview,
  addReviewFile,
  getReviewFiles,
  getReviewFile,
  updateFileStatus,
  updateFileDiff,
  deleteReviewFile,
  addAnnotation,
  getAnnotationsForFile,
  getAnnotationsForReview,
  updateAnnotation,
  deleteAnnotation,
  moveAnnotation,
  markAnnotationStale,
  markAnnotationCurrent,
  deleteStaleAnnotations,
  keepAllStaleAnnotations,
  getStaleCountsForReview,
} from '../../../src/db/queries.js';
import {
  createAttachment,
  getAttachmentsForAnnotation,
} from '../../../src/db/attachment-queries.js';

describe('queries', () => {
  beforeAll(async () => {
    const db = await setupTestDb();
    vi.mocked(getDb).mockResolvedValue(db);
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  // --- Reviews ---

  describe('Reviews', () => {
    it('createReview creates with generated ID and default status in_progress', async () => {
      const review = await createReview('/repo/path', 'my-repo', 'uncommitted');
      expect(review.id).toBeDefined();
      expect(review.id.length).toBeGreaterThan(0);
      expect(review.repo_path).toBe('/repo/path');
      expect(review.repo_name).toBe('my-repo');
      expect(review.mode).toBe('uncommitted');
      expect(review.status).toBe('in_progress');
      expect(review.mode_args).toBeNull();
      expect(review.head_commit).toBeNull();
      expect(review.created_at).toBeDefined();
      expect(review.updated_at).toBeDefined();
    });

    it('getReview retrieves created review with all fields', async () => {
      const created = await createReview('/repo/get-test', 'get-repo', 'staged', 'some-args', 'abc123');
      const retrieved = await getReview(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.repo_path).toBe('/repo/get-test');
      expect(retrieved!.repo_name).toBe('get-repo');
      expect(retrieved!.mode).toBe('staged');
      expect(retrieved!.mode_args).toBe('some-args');
      expect(retrieved!.head_commit).toBe('abc123');
      expect(retrieved!.status).toBe('in_progress');
    });

    it('getReview returns undefined for non-existent ID', async () => {
      const result = await getReview('nonexistent-id-12345');
      expect(result).toBeUndefined();
    });

    it('listReviews returns all reviews ordered by created_at DESC', async () => {
      // Create reviews with small delays to ensure ordering
      const r1 = await createReview('/repo/list', 'list-repo', 'uncommitted');
      const r2 = await createReview('/repo/list', 'list-repo', 'staged');
      const r3 = await createReview('/repo/other', 'other-repo', 'branch');

      const all = await listReviews();
      expect(all.length).toBeGreaterThanOrEqual(3);

      // Verify DESC ordering: most recent first
      for (let i = 0; i < all.length - 1; i++) {
        expect(new Date(all[i].created_at).getTime()).toBeGreaterThanOrEqual(
          new Date(all[i + 1].created_at).getTime()
        );
      }

      // All three should be present
      const ids = all.map(r => r.id);
      expect(ids).toContain(r1.id);
      expect(ids).toContain(r2.id);
      expect(ids).toContain(r3.id);
    });

    it('listReviews with repoPath filter only returns matching reviews', async () => {
      const uniquePath = '/repo/filter-test-' + Date.now();
      const r1 = await createReview(uniquePath, 'filter-repo', 'uncommitted');
      const r2 = await createReview(uniquePath, 'filter-repo', 'staged');
      await createReview('/repo/other-filter', 'other', 'branch');

      const filtered = await listReviews(uniquePath);
      expect(filtered.length).toBe(2);
      const ids = filtered.map(r => r.id);
      expect(ids).toContain(r1.id);
      expect(ids).toContain(r2.id);
    });

    it('updateReviewStatus changes status', async () => {
      const review = await createReview('/repo/status', 'status-repo', 'uncommitted');
      expect(review.status).toBe('in_progress');

      await updateReviewStatus(review.id, 'completed');
      const updated = await getReview(review.id);
      expect(updated!.status).toBe('completed');
      // updated_at should be changed
      expect(new Date(updated!.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(review.updated_at).getTime()
      );
    });

    it('deleteReview removes review and cascade deletes files/annotations', async () => {
      const review = await createReview('/repo/delete', 'delete-repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');
      const annotation = await addAnnotation(file.id, 10, 'new', 'bug', 'found a bug');
      // An attachment on the annotation must cascade away too (doc 25 NFR-25.2).
      await createAttachment({
        annotationId: annotation.id,
        originalFilename: 'proof.png',
        storedPath: '/data/attachments/proof.png',
        mimeType: 'image/png',
        size: 123,
        sha256: null,
      });

      // Verify they exist
      expect(await getReview(review.id)).toBeDefined();
      expect(await getReviewFile(file.id)).toBeDefined();
      expect((await getAnnotationsForFile(file.id)).length).toBe(1);
      expect((await getAttachmentsForAnnotation(annotation.id)).length).toBe(1);

      await deleteReview(review.id);

      // All should be gone, including the attachment (annotation FK cascade)
      expect(await getReview(review.id)).toBeUndefined();
      expect(await getReviewFile(file.id)).toBeUndefined();
      expect((await getAnnotationsForFile(file.id)).length).toBe(0);
      expect((await getAttachmentsForAnnotation(annotation.id)).length).toBe(0);
    });

    it('getLatestInProgressReview matches by repo+mode', async () => {
      const uniquePath = '/repo/latest-' + Date.now();
      const r1 = await createReview(uniquePath, 'latest-repo', 'uncommitted');
      // Small delay to ensure distinct created_at timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      const r2 = await createReview(uniquePath, 'latest-repo', 'uncommitted');

      const latest = await getLatestInProgressReview(uniquePath, 'uncommitted');
      expect(latest).toBeDefined();
      // Should be the most recently created one
      expect(latest!.id).toBe(r2.id);
    });

    it('getLatestInProgressReview returns undefined when none match', async () => {
      const result = await getLatestInProgressReview('/nonexistent/repo', 'uncommitted');
      expect(result).toBeUndefined();
    });

    it('getLatestInProgressReview ignores completed reviews', async () => {
      const uniquePath = '/repo/latest-completed-' + Date.now();
      const r1 = await createReview(uniquePath, 'repo', 'uncommitted');
      await updateReviewStatus(r1.id, 'completed');

      const latest = await getLatestInProgressReview(uniquePath, 'uncommitted');
      expect(latest).toBeUndefined();
    });

    it('getLatestInProgressReview filters by modeArgs', async () => {
      const uniquePath = '/repo/latest-args-' + Date.now();
      await createReview(uniquePath, 'repo', 'branch', 'feature-1');
      const r2 = await createReview(uniquePath, 'repo', 'branch', 'feature-2');

      const latest = await getLatestInProgressReview(uniquePath, 'branch', 'feature-2');
      expect(latest).toBeDefined();
      expect(latest!.id).toBe(r2.id);
    });

    it('updateReviewHead updates head_commit', async () => {
      const review = await createReview('/repo/head', 'head-repo', 'uncommitted');
      expect(review.head_commit).toBeNull();

      await updateReviewHead(review.id, 'def456');
      const updated = await getReview(review.id);
      expect(updated!.head_commit).toBe('def456');
    });
  });

  // --- Review Files ---

  describe('Review Files', () => {
    it('addReviewFile creates file linked to review', async () => {
      const review = await createReview('/repo/files', 'files-repo', 'uncommitted');
      const diffData = JSON.stringify({ hunks: [] });
      const file = await addReviewFile(review.id, 'src/index.ts', diffData);

      expect(file.id).toBeDefined();
      expect(file.review_id).toBe(review.id);
      expect(file.file_path).toBe('src/index.ts');
      expect(file.diff_data).toBe(diffData);
      expect(file.status).toBe('pending');
      expect(file.created_at).toBeDefined();
    });

    it('getReviewFiles returns files ordered by file_path', async () => {
      const review = await createReview('/repo/files-order', 'order-repo', 'uncommitted');
      await addReviewFile(review.id, 'src/z-file.ts', '{}');
      await addReviewFile(review.id, 'src/a-file.ts', '{}');
      await addReviewFile(review.id, 'src/m-file.ts', '{}');

      const files = await getReviewFiles(review.id);
      expect(files.length).toBe(3);
      expect(files[0].file_path).toBe('src/a-file.ts');
      expect(files[1].file_path).toBe('src/m-file.ts');
      expect(files[2].file_path).toBe('src/z-file.ts');
    });

    it('updateFileStatus changes status', async () => {
      const review = await createReview('/repo/file-status', 'repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');
      expect(file.status).toBe('pending');

      await updateFileStatus(file.id, 'reviewed');
      const updated = await getReviewFile(file.id);
      expect(updated!.status).toBe('reviewed');
    });

    it('updateFileDiff changes diff_data', async () => {
      const review = await createReview('/repo/file-diff', 'repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{"old": true}');

      const newDiff = '{"new": true}';
      await updateFileDiff(file.id, newDiff);
      const updated = await getReviewFile(file.id);
      expect(updated!.diff_data).toBe(newDiff);
    });

    it('deleteReviewFile removes file and its annotations', async () => {
      const review = await createReview('/repo/file-delete', 'repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');
      await addAnnotation(file.id, 5, 'new', 'note', 'some note');

      expect(await getReviewFile(file.id)).toBeDefined();
      expect((await getAnnotationsForFile(file.id)).length).toBe(1);

      await deleteReviewFile(file.id);
      expect(await getReviewFile(file.id)).toBeUndefined();
      expect((await getAnnotationsForFile(file.id)).length).toBe(0);
    });
  });

  // --- Annotations ---

  describe('Annotations', () => {
    it('addAnnotation creates annotation with defaults', async () => {
      const review = await createReview('/repo/ann', 'ann-repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');
      const ann = await addAnnotation(file.id, 42, 'new', 'bug', 'This is a bug');

      expect(ann.id).toBeDefined();
      expect(ann.review_file_id).toBe(file.id);
      expect(ann.line_number).toBe(42);
      expect(ann.side).toBe('new');
      expect(ann.category).toBe('bug');
      expect(ann.content).toBe('This is a bug');
      expect(ann.is_stale).toBe(false);
      expect(ann.original_content).toBeNull();
      expect(ann.reply_to_note_id).toBeNull();
      expect(ann.created_at).toBeDefined();
      expect(ann.updated_at).toBeDefined();
    });

    it('addAnnotation stores reply_to_note_id when replying to an AI review note (GB-906)', async () => {
      const review = await createReview('/repo/ann-reply', 'repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');
      const reply = await addAnnotation(file.id, 7, 'new', 'note', 'I disagree with this', 'note-guid-123');
      expect(reply.reply_to_note_id).toBe('note-guid-123');

      const fetched = await getAnnotationsForFile(file.id);
      expect(fetched[0].reply_to_note_id).toBe('note-guid-123');
    });

    it('getAnnotationsForFile returns ordered by line_number', async () => {
      const review = await createReview('/repo/ann-order', 'repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');
      await addAnnotation(file.id, 30, 'new', 'note', 'line 30');
      await addAnnotation(file.id, 10, 'new', 'note', 'line 10');
      await addAnnotation(file.id, 20, 'new', 'note', 'line 20');

      const anns = await getAnnotationsForFile(file.id);
      expect(anns.length).toBe(3);
      expect(anns[0].line_number).toBe(10);
      expect(anns[1].line_number).toBe(20);
      expect(anns[2].line_number).toBe(30);
    });

    it('getAnnotationsForReview joins with file_path', async () => {
      const review = await createReview('/repo/ann-review', 'repo', 'uncommitted');
      const file1 = await addReviewFile(review.id, 'alpha.ts', '{}');
      const file2 = await addReviewFile(review.id, 'beta.ts', '{}');
      await addAnnotation(file1.id, 5, 'new', 'bug', 'bug in alpha');
      await addAnnotation(file2.id, 10, 'new', 'fix', 'fix in beta');

      const anns = await getAnnotationsForReview(review.id);
      expect(anns.length).toBe(2);
      // Should be ordered by file_path, then line_number
      expect(anns[0].file_path).toBe('alpha.ts');
      expect(anns[0].content).toBe('bug in alpha');
      expect(anns[1].file_path).toBe('beta.ts');
      expect(anns[1].content).toBe('fix in beta');
    });

    it('updateAnnotation changes content and category', async () => {
      const review = await createReview('/repo/ann-update', 'repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');
      const ann = await addAnnotation(file.id, 10, 'new', 'note', 'original content');

      await updateAnnotation(ann.id, 'updated content', 'bug');
      const anns = await getAnnotationsForFile(file.id);
      const updated = anns.find(a => a.id === ann.id);
      expect(updated!.content).toBe('updated content');
      expect(updated!.category).toBe('bug');
    });

    it('deleteAnnotation removes annotation', async () => {
      const review = await createReview('/repo/ann-delete', 'repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');
      const ann = await addAnnotation(file.id, 10, 'new', 'note', 'to delete');

      expect((await getAnnotationsForFile(file.id)).length).toBe(1);
      await deleteAnnotation(ann.id);
      expect((await getAnnotationsForFile(file.id)).length).toBe(0);
    });

    it('moveAnnotation changes line and side, clears stale', async () => {
      const review = await createReview('/repo/ann-move', 'repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');
      const ann = await addAnnotation(file.id, 10, 'new', 'note', 'moveable');

      // First mark it stale
      await markAnnotationStale(ann.id, 'original line content');
      let anns = await getAnnotationsForFile(file.id);
      expect(anns[0].is_stale).toBe(true);

      // Now move it
      await moveAnnotation(ann.id, 20, 'old');
      anns = await getAnnotationsForFile(file.id);
      const moved = anns.find(a => a.id === ann.id)!;
      expect(moved.line_number).toBe(20);
      expect(moved.side).toBe('old');
      expect(moved.is_stale).toBe(false);
      expect(moved.original_content).toBeNull();
    });

    it('markAnnotationStale and markAnnotationCurrent cycle', async () => {
      const review = await createReview('/repo/ann-stale', 'repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');
      const ann = await addAnnotation(file.id, 10, 'new', 'note', 'content');

      // Initially not stale
      let anns = await getAnnotationsForFile(file.id);
      expect(anns[0].is_stale).toBe(false);
      expect(anns[0].original_content).toBeNull();

      // Mark stale
      await markAnnotationStale(ann.id, 'the original line');
      anns = await getAnnotationsForFile(file.id);
      expect(anns[0].is_stale).toBe(true);
      expect(anns[0].original_content).toBe('the original line');

      // Mark current again
      await markAnnotationCurrent(ann.id);
      anns = await getAnnotationsForFile(file.id);
      expect(anns[0].is_stale).toBe(false);
      expect(anns[0].original_content).toBeNull();
    });

    it('deleteStaleAnnotations only removes stale ones', async () => {
      const review = await createReview('/repo/ann-del-stale', 'repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');
      const ann1 = await addAnnotation(file.id, 10, 'new', 'note', 'stale one');
      const ann2 = await addAnnotation(file.id, 20, 'new', 'note', 'fresh one');
      const ann3 = await addAnnotation(file.id, 30, 'new', 'note', 'stale two');

      await markAnnotationStale(ann1.id, 'orig1');
      await markAnnotationStale(ann3.id, 'orig3');

      await deleteStaleAnnotations(review.id);

      const remaining = await getAnnotationsForFile(file.id);
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(ann2.id);
      expect(remaining[0].content).toBe('fresh one');
    });

    it('keepAllStaleAnnotations marks all as current', async () => {
      const review = await createReview('/repo/ann-keep-stale', 'repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');
      const ann1 = await addAnnotation(file.id, 10, 'new', 'note', 'one');
      const ann2 = await addAnnotation(file.id, 20, 'new', 'note', 'two');

      await markAnnotationStale(ann1.id, 'orig1');
      await markAnnotationStale(ann2.id, 'orig2');

      await keepAllStaleAnnotations(review.id);

      const anns = await getAnnotationsForFile(file.id);
      expect(anns.length).toBe(2);
      for (const ann of anns) {
        expect(ann.is_stale).toBe(false);
        expect(ann.original_content).toBeNull();
      }
    });

    it('getStaleCountsForReview returns counts per file', async () => {
      const review = await createReview('/repo/ann-stale-counts', 'repo', 'uncommitted');
      const file1 = await addReviewFile(review.id, 'a.ts', '{}');
      const file2 = await addReviewFile(review.id, 'b.ts', '{}');

      const a1 = await addAnnotation(file1.id, 10, 'new', 'note', 'a1');
      const a2 = await addAnnotation(file1.id, 20, 'new', 'note', 'a2');
      const a3 = await addAnnotation(file1.id, 30, 'new', 'note', 'a3 fresh');
      const b1 = await addAnnotation(file2.id, 5, 'new', 'note', 'b1');

      await markAnnotationStale(a1.id, 'orig');
      await markAnnotationStale(a2.id, 'orig');
      await markAnnotationStale(b1.id, 'orig');

      const counts = await getStaleCountsForReview(review.id);
      expect(counts[file1.id]).toBe(2);
      expect(counts[file2.id]).toBe(1);
      // file with no stale annotations should not appear
      expect(Object.keys(counts).length).toBe(2);
    });
  });
});
