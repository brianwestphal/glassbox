/**
 * Integration tests for the API routes in src/routes/api.ts.
 *
 * Uses an in-memory PGLite database and Hono's built-in request testing
 * (no actual HTTP server needed). The test Hono app mirrors the middleware
 * from src/server.ts that injects reviewId, currentReviewId, and repoRoot.
 */
import { PGlite } from '@electric-sql/pglite';
import { mkdirSync, writeFileSync } from 'fs';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../../src/types.js';
import { SCHEMA_CORE_SQL, SCHEMA_AI_SQL } from '../../../src/db/ddl.js';

// --- Database setup ---

let testDb: PGlite;
const TEST_REVIEW_ID = 'test-review-001';
const TEST_REVIEW_ID_2 = 'test-review-002';
// Use `os.tmpdir()` rather than a hardcoded `/tmp/test-repo`. macOS sandbox
// profiles (and the harness sandbox we run under) restrict writes to the
// returned directory; a hardcoded path outside that fails with EPERM and
// breaks the project-settings integration tests.
const TEST_REPO_ROOT = `${tmpdir()}/glassbox-test-repo`;
const TEST_FILE_ID = 'test-file-001';
const TEST_FILE_ID_2 = 'test-file-002';

// Mock the database connection before any route imports
vi.mock('../../../src/db/connection.js', () => ({
  getDb: async () => testDb,
}));

// Mock the export module to avoid filesystem/git side effects
vi.mock('../../../src/export/generate.js', () => ({
  generateReviewExport: vi.fn(async () => `${tmpdir()}/glassbox-test-repo/.glassbox/latest-review.md`),
  shouldPromptGitignore: vi.fn(() => false),
  addGlassboxToGitignore: vi.fn(),
  dismissGitignorePrompt: vi.fn(),
  deleteReviewExport: vi.fn(),
}));

// Mock the git/diff module to avoid filesystem access
vi.mock('../../../src/git/diff.js', () => ({
  getFileContent: vi.fn(() => 'line1\nline2\nline3\nline4\nline5\n'),
  // Used by the context route to read file content for the review's mode
  // (direct comparison reads from disk, git modes from a ref). The integration
  // tests use a synthetic uncommitted-mode review, so a fixed string suffices.
  getModeFileContent: vi.fn(() => 'line1\nline2\nline3\nline4\nline5\n'),
  parseModeString: vi.fn(() => ({ type: 'uncommitted' })),
  getHeadCommit: vi.fn(() => 'abc123'),
  getFileDiffs: vi.fn(() => []),
  parseDiffData: vi.fn((raw: string | null | undefined) => {
    if (raw === null || raw === undefined || raw === '') return null;
    try { return JSON.parse(raw); } catch { return null; }
  }),
}));

// Mock the outline parser to avoid filesystem access
vi.mock('../../../src/outline/parser.js', () => ({
  parseOutline: vi.fn(() => []),
}));

// Mock auto-export to avoid side effects from annotation mutations
vi.mock('../../../src/export/auto-export.js', () => ({
  scheduleAutoExport: vi.fn(),
}));

// Mock review-update to avoid filesystem/git access
vi.mock('../../../src/review-update.js', () => ({
  updateReviewDiffs: vi.fn(async () => ({ updated: 1, added: 0, stale: 0 })),
}));

// Mock git/image module to avoid filesystem access
vi.mock('../../../src/git/image.js', () => ({
  getOldImage: vi.fn(() => null),
  getNewImage: vi.fn(() => null),
  isImageFile: vi.fn(() => false),
  isSvgFile: vi.fn(() => false),
  getContentType: vi.fn(() => 'image/png'),
  extractMetadata: vi.fn(async () => null),
  formatMetadataLines: vi.fn(() => []),
}));

// Import the routes after mocks are set up (vi.mock is hoisted)
import { apiRoutes } from '../../../src/routes/api.js';
// Imports of the mocked modules so individual tests can override their
// behavior via `vi.mocked(...).mockImplementation(...)`.
import { getNewImage, getOldImage, getContentType, isSvgFile } from '../../../src/git/image.js';

// Build the test Hono app, mirroring the server middleware
function createTestApp(currentReviewId: string = TEST_REVIEW_ID): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('reviewId', TEST_REVIEW_ID);
    c.set('currentReviewId', currentReviewId);
    c.set('repoRoot', TEST_REPO_ROOT);
    await next();
  });

  app.route('/api', apiRoutes);
  return app;
}

let app: Hono<AppEnv>;

async function initSchema(db: PGlite): Promise<void> {
  await db.exec(SCHEMA_CORE_SQL);
  await db.exec(SCHEMA_AI_SQL);
}

async function seedTestData(db: PGlite): Promise<void> {
  // Create test reviews
  await db.query(
    `INSERT INTO reviews (id, repo_path, repo_name, mode, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [TEST_REVIEW_ID, TEST_REPO_ROOT, 'test-repo', 'uncommitted', 'in_progress']
  );
  await db.query(
    `INSERT INTO reviews (id, repo_path, repo_name, mode, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [TEST_REVIEW_ID_2, TEST_REPO_ROOT, 'test-repo', 'staged', 'completed']
  );

  // Create test files
  const diffData = JSON.stringify({
    filePath: 'src/app.ts',
    status: 'modified',
    hunks: [{ oldStart: 1, oldCount: 3, newStart: 1, newCount: 4, lines: [] }],
  });
  await db.query(
    `INSERT INTO review_files (id, review_id, file_path, diff_data, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [TEST_FILE_ID, TEST_REVIEW_ID, 'src/app.ts', diffData, 'pending']
  );
  await db.query(
    `INSERT INTO review_files (id, review_id, file_path, diff_data, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [TEST_FILE_ID_2, TEST_REVIEW_ID, 'src/utils.ts', diffData, 'pending']
  );
}

beforeAll(async () => {
  testDb = new PGlite();
  await testDb.waitReady;
  await initSchema(testDb);
  await seedTestData(testDb);
  app = createTestApp();
});

afterAll(async () => {
  if (testDb) {
    await testDb.close();
  }
});

// ===== Reviews =====

describe('GET /api/reviews', () => {
  it('returns all reviews for the repo', async () => {
    const res = await app.request('/api/reviews');
    expect(res.status).toBe(200);

    const reviews = await res.json();
    expect(Array.isArray(reviews)).toBe(true);
    expect(reviews.length).toBeGreaterThanOrEqual(2);

    const ids = reviews.map((r: { id: string }) => r.id);
    expect(ids).toContain(TEST_REVIEW_ID);
    expect(ids).toContain(TEST_REVIEW_ID_2);
  });
});

describe('GET /api/review', () => {
  it('returns the current review from middleware', async () => {
    const res = await app.request('/api/review');
    expect(res.status).toBe(200);

    const review = await res.json();
    expect(review.id).toBe(TEST_REVIEW_ID);
    expect(review.repo_name).toBe('test-repo');
    expect(review.mode).toBe('uncommitted');
    expect(review.status).toBe('in_progress');
  });

  it('returns a specific review when reviewId query param is provided', async () => {
    const res = await app.request(`/api/review?reviewId=${TEST_REVIEW_ID_2}`);
    expect(res.status).toBe(200);

    const review = await res.json();
    expect(review.id).toBe(TEST_REVIEW_ID_2);
    expect(review.mode).toBe('staged');
    expect(review.status).toBe('completed');
  });
});

describe('POST /api/review/complete', () => {
  it('marks the review as completed and returns export info', async () => {
    // First reopen so we can complete it
    await app.request('/api/review/reopen', { method: 'POST' });

    const res = await app.request('/api/review/complete', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('completed');
    expect(body.exportPath).toBeDefined();
    expect(body.isCurrent).toBe(true);
    expect(body.reviewId).toBe(TEST_REVIEW_ID);
    expect(typeof body.gitignorePrompt).toBe('boolean');
  });
});

describe('POST /api/review/reopen', () => {
  it('reopens a completed review', async () => {
    // Ensure it is completed first
    await app.request('/api/review/complete', { method: 'POST' });

    const res = await app.request('/api/review/reopen', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('in_progress');

    // Verify the review is actually reopened
    const reviewRes = await app.request('/api/review');
    const review = await reviewRes.json();
    expect(review.status).toBe('in_progress');
  });
});

describe('DELETE /api/review/:id', () => {
  it('prevents deleting the current review', async () => {
    const res = await app.request(`/api/review/${TEST_REVIEW_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Cannot delete the current review');
  });

  it('deletes a non-current review', async () => {
    // Create a throwaway review to delete
    const throwawayId = 'throwaway-review';
    await testDb.query(
      `INSERT INTO reviews (id, repo_path, repo_name, mode, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [throwawayId, TEST_REPO_ROOT, 'test-repo', 'uncommitted', 'completed']
    );

    const res = await app.request(`/api/review/${throwawayId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify it's gone
    const check = await testDb.query('SELECT * FROM reviews WHERE id = $1', [throwawayId]);
    expect(check.rows.length).toBe(0);
  });
});

describe('POST /api/reviews/delete-completed', () => {
  it('deletes completed reviews except current', async () => {
    // Seed a completed review to be deleted
    const completedId = 'completed-to-delete';
    await testDb.query(
      `INSERT INTO reviews (id, repo_path, repo_name, mode, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [completedId, TEST_REPO_ROOT, 'test-repo', 'uncommitted', 'completed']
    );

    const res = await app.request('/api/reviews/delete-completed', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.deleted).toBeGreaterThanOrEqual(1);

    // The completed review should be gone
    const check = await testDb.query('SELECT * FROM reviews WHERE id = $1', [completedId]);
    expect(check.rows.length).toBe(0);
  });
});

// ===== Files =====

describe('GET /api/files', () => {
  it('returns files for the current review with annotation counts', async () => {
    const res = await app.request('/api/files');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.files)).toBe(true);
    expect(body.files.length).toBe(2);

    const filePaths = body.files.map((f: { file_path: string }) => f.file_path);
    expect(filePaths).toContain('src/app.ts');
    expect(filePaths).toContain('src/utils.ts');

    expect(typeof body.annotationCounts).toBe('object');
    expect(typeof body.staleCounts).toBe('object');
  });
});

describe('GET /api/files/:fileId', () => {
  it('returns a file with its annotations', async () => {
    const res = await app.request(`/api/files/${TEST_FILE_ID}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.file).toBeDefined();
    expect(body.file.id).toBe(TEST_FILE_ID);
    expect(body.file.file_path).toBe('src/app.ts');
    expect(Array.isArray(body.annotations)).toBe(true);
  });

  it('returns 404 for a non-existent file', async () => {
    const res = await app.request('/api/files/nonexistent-file');
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});

describe('PATCH /api/files/:fileId/status', () => {
  it('updates a file status to reviewed', async () => {
    const res = await app.request(`/api/files/${TEST_FILE_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'reviewed' }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify the status was updated
    const fileRes = await app.request(`/api/files/${TEST_FILE_ID}`);
    const fileBody = await fileRes.json();
    expect(fileBody.file.status).toBe('reviewed');
  });

  it('updates a file status back to pending', async () => {
    const res = await app.request(`/api/files/${TEST_FILE_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    });
    expect(res.status).toBe(200);

    const fileRes = await app.request(`/api/files/${TEST_FILE_ID}`);
    const fileBody = await fileRes.json();
    expect(fileBody.file.status).toBe('pending');
  });
});

// ===== Annotations =====

describe('POST /api/annotations', () => {
  it('creates a new annotation and returns it with 201 status', async () => {
    const res = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 10,
        side: 'new',
        category: 'bug',
        content: 'This looks like a null pointer dereference',
      }),
    });
    expect(res.status).toBe(201);

    const annotation = await res.json();
    expect(annotation.id).toBeDefined();
    expect(annotation.review_file_id).toBe(TEST_FILE_ID);
    expect(annotation.line_number).toBe(10);
    expect(annotation.side).toBe('new');
    expect(annotation.category).toBe('bug');
    expect(annotation.content).toBe('This looks like a null pointer dereference');
    expect(annotation.is_stale).toBe(false);
  });

  it('creates annotations with different categories', async () => {
    const categories = ['fix', 'style', 'note', 'pattern-follow', 'pattern-avoid', 'remember'];

    for (const category of categories) {
      const res = await app.request('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewFileId: TEST_FILE_ID,
          lineNumber: 20,
          side: 'new',
          category,
          content: `Test annotation for ${category}`,
        }),
      });
      expect(res.status).toBe(201);
      const annotation = await res.json();
      expect(annotation.category).toBe(category);
    }
  });
});

// Doc 23 — image feedback. Image-level annotations use line_number 0; a region
// comment additionally carries a normalized {x,y,w,h} rectangle in region_data.
describe('POST /api/annotations — image feedback (doc 23)', () => {
  it('creates a general image comment (lineNumber 0, no region)', async () => {
    const res = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 0,
        side: 'new',
        category: 'note',
        content: 'The overall contrast dropped',
      }),
    });
    expect(res.status).toBe(201);
    const annotation = await res.json();
    expect(annotation.line_number).toBe(0);
    expect(annotation.region_data).toBeNull();
    expect(annotation.content).toBe('The overall contrast dropped');
  });

  it('creates a region comment and stores the normalized rectangle', async () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.25 };
    const res = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 0,
        side: 'new',
        category: 'note',
        content: 'This logo is misaligned',
        region,
      }),
    });
    expect(res.status).toBe(201);
    const annotation = await res.json();
    expect(annotation.line_number).toBe(0);
    expect(JSON.parse(annotation.region_data)).toEqual(region);
  });

  it('rejects a region with out-of-range coordinates', async () => {
    const res = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 0,
        side: 'new',
        category: 'note',
        content: 'bad region',
        region: { x: 1.5, y: 0, w: 0.2, h: 0.2 },
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/annotations/:id', () => {
  it('updates an annotation content and category', async () => {
    // Create an annotation first
    const createRes = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 15,
        side: 'new',
        category: 'note',
        content: 'Original content',
      }),
    });
    const created = await createRes.json();

    // Update it
    const res = await app.request(`/api/annotations/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Updated content',
        category: 'bug',
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify the update by fetching the file's annotations
    const fileRes = await app.request(`/api/files/${TEST_FILE_ID}`);
    const fileBody = await fileRes.json();
    const updated = fileBody.annotations.find((a: { id: string }) => a.id === created.id);
    expect(updated.content).toBe('Updated content');
    expect(updated.category).toBe('bug');
  });
});

describe('DELETE /api/annotations/:id', () => {
  it('deletes an annotation', async () => {
    // Create one to delete
    const createRes = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 30,
        side: 'new',
        category: 'note',
        content: 'To be deleted',
      }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/annotations/${created.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify it's gone
    const fileRes = await app.request(`/api/files/${TEST_FILE_ID}`);
    const fileBody = await fileRes.json();
    const found = fileBody.annotations.find((a: { id: string }) => a.id === created.id);
    expect(found).toBeUndefined();
  });
});

describe('PATCH /api/annotations/:id/move', () => {
  it('moves an annotation to a new line and side', async () => {
    // Create one to move
    const createRes = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 5,
        side: 'old',
        category: 'note',
        content: 'Moveable annotation',
      }),
    });
    const created = await createRes.json();
    expect(created.line_number).toBe(5);
    expect(created.side).toBe('old');

    // Move it
    const res = await app.request(`/api/annotations/${created.id}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineNumber: 42, side: 'new' }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify the move
    const fileRes = await app.request(`/api/files/${TEST_FILE_ID}`);
    const fileBody = await fileRes.json();
    const moved = fileBody.annotations.find((a: { id: string }) => a.id === created.id);
    expect(moved.line_number).toBe(42);
    expect(moved.side).toBe('new');
  });
});

describe('POST /api/annotations/:id/keep', () => {
  it('marks a stale annotation as current', async () => {
    // Create an annotation, then manually mark it stale
    const createRes = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 50,
        side: 'new',
        category: 'note',
        content: 'Stale annotation to keep',
      }),
    });
    const created = await createRes.json();

    // Mark it stale directly in the database
    await testDb.query(
      `UPDATE annotations SET is_stale = TRUE, original_content = $1 WHERE id = $2`,
      ['original context line', created.id]
    );

    // Verify it's stale
    const beforeRes = await testDb.query('SELECT is_stale, original_content FROM annotations WHERE id = $1', [created.id]);
    expect(beforeRes.rows[0].is_stale).toBe(true);
    expect(beforeRes.rows[0].original_content).toBe('original context line');

    // Keep it
    const res = await app.request(`/api/annotations/${created.id}/keep`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify it's no longer stale
    const afterRes = await testDb.query('SELECT is_stale, original_content FROM annotations WHERE id = $1', [created.id]);
    expect(afterRes.rows[0].is_stale).toBe(false);
    expect(afterRes.rows[0].original_content).toBeNull();
  });
});

describe('GET /api/annotations/all', () => {
  it('returns all annotations for the current review with file paths', async () => {
    // Clear existing annotations and create fresh ones for a clean test
    await testDb.query(
      `DELETE FROM annotations WHERE review_file_id IN ($1, $2)`,
      [TEST_FILE_ID, TEST_FILE_ID_2]
    );

    // Create annotations on different files
    await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 1,
        side: 'new',
        category: 'bug',
        content: 'Bug in app.ts',
      }),
    });
    await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID_2,
        lineNumber: 5,
        side: 'new',
        category: 'style',
        content: 'Style issue in utils.ts',
      }),
    });

    const res = await app.request('/api/annotations/all');
    expect(res.status).toBe(200);

    const annotations = await res.json();
    expect(Array.isArray(annotations)).toBe(true);
    expect(annotations.length).toBe(2);

    // Annotations should include file_path from the join
    const appAnnotation = annotations.find((a: { file_path: string }) => a.file_path === 'src/app.ts');
    const utilsAnnotation = annotations.find((a: { file_path: string }) => a.file_path === 'src/utils.ts');
    expect(appAnnotation).toBeDefined();
    expect(utilsAnnotation).toBeDefined();
    expect(appAnnotation.content).toBe('Bug in app.ts');
    expect(utilsAnnotation.content).toBe('Style issue in utils.ts');
  });
});

describe('POST /api/annotations/stale/delete-all', () => {
  it('deletes all stale annotations for the review', async () => {
    // Clear and set up
    await testDb.query(
      `DELETE FROM annotations WHERE review_file_id IN ($1, $2)`,
      [TEST_FILE_ID, TEST_FILE_ID_2]
    );

    // Create two annotations, mark both stale
    const res1 = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 1,
        side: 'new',
        category: 'note',
        content: 'Stale 1',
      }),
    });
    const a1 = await res1.json();

    const res2 = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 2,
        side: 'new',
        category: 'note',
        content: 'Not stale',
      }),
    });
    const a2 = await res2.json();

    // Mark one as stale
    await testDb.query('UPDATE annotations SET is_stale = TRUE WHERE id = $1', [a1.id]);

    // Delete all stale
    const res = await app.request('/api/annotations/stale/delete-all', { method: 'POST' });
    expect(res.status).toBe(200);

    // The stale one should be gone, the non-stale one should remain
    const check1 = await testDb.query('SELECT * FROM annotations WHERE id = $1', [a1.id]);
    expect(check1.rows.length).toBe(0);

    const check2 = await testDb.query('SELECT * FROM annotations WHERE id = $1', [a2.id]);
    expect(check2.rows.length).toBe(1);
  });
});

describe('POST /api/annotations/stale/keep-all', () => {
  it('marks all stale annotations as current for the review', async () => {
    // Clear and set up
    await testDb.query(
      `DELETE FROM annotations WHERE review_file_id IN ($1, $2)`,
      [TEST_FILE_ID, TEST_FILE_ID_2]
    );

    // Create two annotations, mark both stale
    const res1 = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 1,
        side: 'new',
        category: 'note',
        content: 'Was stale 1',
      }),
    });
    const a1 = await res1.json();

    const res2 = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 2,
        side: 'new',
        category: 'note',
        content: 'Was stale 2',
      }),
    });
    const a2 = await res2.json();

    await testDb.query('UPDATE annotations SET is_stale = TRUE, original_content = $1 WHERE id IN ($2, $3)',
      ['old context', a1.id, a2.id]);

    // Keep all stale
    const res = await app.request('/api/annotations/stale/keep-all', { method: 'POST' });
    expect(res.status).toBe(200);

    // Both should now be current
    const check = await testDb.query(
      'SELECT is_stale, original_content FROM annotations WHERE id IN ($1, $2) ORDER BY line_number',
      [a1.id, a2.id]
    );
    expect(check.rows.length).toBe(2);
    for (const row of check.rows) {
      expect(row.is_stale).toBe(false);
      expect(row.original_content).toBeNull();
    }
  });
});

// ===== File annotation counts =====

describe('GET /api/files annotation counting', () => {
  beforeEach(async () => {
    // Clean up annotations
    await testDb.query(
      `DELETE FROM annotations WHERE review_file_id IN ($1, $2)`,
      [TEST_FILE_ID, TEST_FILE_ID_2]
    );
  });

  it('returns correct annotation counts per file', async () => {
    // Add 2 annotations to file 1
    for (let i = 0; i < 2; i++) {
      await app.request('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewFileId: TEST_FILE_ID,
          lineNumber: i + 1,
          side: 'new',
          category: 'note',
          content: `Annotation ${i}`,
        }),
      });
    }

    // Add 1 annotation to file 2
    await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID_2,
        lineNumber: 1,
        side: 'new',
        category: 'note',
        content: 'Single annotation',
      }),
    });

    const res = await app.request('/api/files');
    const body = await res.json();

    expect(body.annotationCounts[TEST_FILE_ID]).toBe(2);
    expect(body.annotationCounts[TEST_FILE_ID_2]).toBe(1);
  });

  it('returns correct stale counts per file', async () => {
    // Create an annotation and mark it stale
    const createRes = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 1,
        side: 'new',
        category: 'note',
        content: 'Will be stale',
      }),
    });
    const annotation = await createRes.json();
    await testDb.query('UPDATE annotations SET is_stale = TRUE WHERE id = $1', [annotation.id]);

    const res = await app.request('/api/files');
    const body = await res.json();

    expect(body.staleCounts[TEST_FILE_ID]).toBe(1);
  });
});

// ===== Context expansion =====

describe('GET /api/context/:fileId', () => {
  it('returns file content lines for the specified range', async () => {
    const res = await app.request(`/api/context/${TEST_FILE_ID}?start=2&end=4`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.lines)).toBe(true);
    expect(body.lines.length).toBe(3);
    expect(body.lines[0].num).toBe(2);
    expect(body.lines[2].num).toBe(4);
  });

  it('returns 404 for a non-existent file', async () => {
    const res = await app.request('/api/context/nonexistent?start=1&end=5');
    expect(res.status).toBe(404);
  });
});

// ===== Outline =====

describe('GET /api/outline/:fileId', () => {
  it('returns symbols for a file', async () => {
    const res = await app.request(`/api/outline/${TEST_FILE_ID}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.symbols).toBeDefined();
    expect(Array.isArray(body.symbols)).toBe(true);
  });

  it('returns 404 for a non-existent file', async () => {
    const res = await app.request('/api/outline/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ===== Gitignore =====

describe('POST /api/gitignore/add', () => {
  it('returns ok', async () => {
    const res = await app.request('/api/gitignore/add', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('POST /api/gitignore/dismiss', () => {
  it('returns ok', async () => {
    const res = await app.request('/api/gitignore/dismiss', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ===== Project Settings =====

describe('GET /api/project-settings', () => {
  it('returns an empty object when no settings file exists', async () => {
    const res = await app.request('/api/project-settings');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });

  it('returns the current settings after they have been written', async () => {
    // Write a setting first via PATCH, then verify GET returns it
    await app.request('/api/project-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName: 'My App' }),
    });

    const res = await app.request('/api/project-settings');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.appName).toBe('My App');
  });
});

describe('PATCH /api/project-settings', () => {
  it('updates appName and returns the new settings', async () => {
    const res = await app.request('/api/project-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName: 'Updated App' }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.appName).toBe('Updated App');
  });

  it('clears appName when an empty string is provided', async () => {
    // Set a name first
    await app.request('/api/project-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName: 'Temporary Name' }),
    });

    // Clear it with an empty string
    const res = await app.request('/api/project-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName: '' }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.appName).toBeUndefined();
  });

  it('persists changes so a subsequent GET returns the updated value', async () => {
    await app.request('/api/project-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName: 'Persisted App' }),
    });

    const res = await app.request('/api/project-settings');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.appName).toBe('Persisted App');
  });
});

// ===== Bulk delete =====

describe('POST /api/reviews/delete-all', () => {
  it('deletes all reviews except the current one', async () => {
    // Create a few extra reviews
    const extraIds = ['extra-1', 'extra-2'];
    for (const id of extraIds) {
      await testDb.query(
        `INSERT INTO reviews (id, repo_path, repo_name, mode, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, TEST_REPO_ROOT, 'test-repo', 'uncommitted', 'in_progress']
      );
    }

    const res = await app.request('/api/reviews/delete-all', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.deleted).toBeGreaterThanOrEqual(2);

    // The current review should still exist
    const currentCheck = await testDb.query('SELECT * FROM reviews WHERE id = $1', [TEST_REVIEW_ID]);
    expect(currentCheck.rows.length).toBe(1);

    // The extras should be gone
    for (const id of extraIds) {
      const check = await testDb.query('SELECT * FROM reviews WHERE id = $1', [id]);
      expect(check.rows.length).toBe(0);
    }
  });
});

// ===== Review refresh =====

describe('POST /api/review/refresh', () => {
  it('returns updated diff stats for the review', async () => {
    const res = await app.request('/api/review/refresh', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(typeof body.updated).toBe('number');
    expect(typeof body.added).toBe('number');
    expect(typeof body.stale).toBe('number');
    expect(typeof body.fileCount).toBe('number');
  });

  it('returns 404 when review does not exist', async () => {
    // Use a reviewId query param that doesn't exist
    const res = await app.request('/api/review/refresh?reviewId=nonexistent', { method: 'POST' });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Review not found');
  });
});

// ===== File reveal =====

describe('POST /api/files/:fileId/reveal', () => {
  it('returns ok for an existing file', async () => {
    const res = await app.request(`/api/files/${TEST_FILE_ID}/reveal`, { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 404 for a non-existent file', async () => {
    const res = await app.request('/api/files/nonexistent/reveal', { method: 'POST' });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});

// ===== Symbol definition search =====

describe('GET /api/symbol-definition', () => {
  it('returns empty definitions when name is not provided', async () => {
    const res = await app.request('/api/symbol-definition');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.definitions).toEqual([]);
  });

  it('returns definitions array when name is provided', async () => {
    const res = await app.request('/api/symbol-definition?name=myFunction');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.definitions)).toBe(true);
  });

  it('accepts currentFileId parameter', async () => {
    const res = await app.request(`/api/symbol-definition?name=myFunction&currentFileId=${TEST_FILE_ID}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.definitions)).toBe(true);
  });
});

// ===== Annotation error handling =====

describe('POST /api/annotations (error handling)', () => {
  it('creates annotation on old side', async () => {
    const res = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 3,
        side: 'old',
        category: 'note',
        content: 'Old side annotation',
      }),
    });
    expect(res.status).toBe(201);

    const annotation = await res.json();
    expect(annotation.side).toBe('old');
    expect(annotation.line_number).toBe(3);
  });

  it('rejects annotation with empty content', async () => {
    const res = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 1,
        side: 'new',
        category: 'note',
        content: '',
      }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('content');
  });
});

// ===== Annotation move clears stale flag =====

describe('PATCH /api/annotations/:id/move (stale clearing)', () => {
  it('clears stale flag when moving a stale annotation', async () => {
    // Create an annotation and mark it stale
    const createRes = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 10,
        side: 'new',
        category: 'bug',
        content: 'Stale annotation to move',
      }),
    });
    const created = await createRes.json();

    // Mark it stale directly in the database
    await testDb.query(
      'UPDATE annotations SET is_stale = TRUE, original_content = $1 WHERE id = $2',
      ['original context', created.id]
    );

    // Verify it's stale
    const beforeRes = await testDb.query('SELECT is_stale FROM annotations WHERE id = $1', [created.id]);
    expect(beforeRes.rows[0].is_stale).toBe(true);

    // Move it — moveAnnotation clears is_stale
    const res = await app.request(`/api/annotations/${created.id}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineNumber: 25, side: 'new' }),
    });
    expect(res.status).toBe(200);

    // Verify stale flag was cleared
    const afterRes = await testDb.query('SELECT is_stale, original_content, line_number FROM annotations WHERE id = $1', [created.id]);
    expect(afterRes.rows[0].is_stale).toBe(false);
    expect(afterRes.rows[0].original_content).toBeNull();
    expect(afterRes.rows[0].line_number).toBe(25);
  });
});

// ===== File status toggle edge cases =====

describe('PATCH /api/files/:fileId/status (edge cases)', () => {
  it('can set status to reviewed and back multiple times', async () => {
    // Set to reviewed
    await app.request(`/api/files/${TEST_FILE_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'reviewed' }),
    });

    let fileRes = await app.request(`/api/files/${TEST_FILE_ID}`);
    let fileBody = await fileRes.json();
    expect(fileBody.file.status).toBe('reviewed');

    // Back to pending
    await app.request(`/api/files/${TEST_FILE_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    });

    fileRes = await app.request(`/api/files/${TEST_FILE_ID}`);
    fileBody = await fileRes.json();
    expect(fileBody.file.status).toBe('pending');

    // Back to reviewed again
    await app.request(`/api/files/${TEST_FILE_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'reviewed' }),
    });

    fileRes = await app.request(`/api/files/${TEST_FILE_ID}`);
    fileBody = await fileRes.json();
    expect(fileBody.file.status).toBe('reviewed');
  });

  it('status update on second file does not affect first file', async () => {
    // Reset both to pending
    await app.request(`/api/files/${TEST_FILE_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    });
    await app.request(`/api/files/${TEST_FILE_ID_2}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    });

    // Mark only file 2 as reviewed
    await app.request(`/api/files/${TEST_FILE_ID_2}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'reviewed' }),
    });

    // File 1 should still be pending
    const file1Res = await app.request(`/api/files/${TEST_FILE_ID}`);
    const file1Body = await file1Res.json();
    expect(file1Body.file.status).toBe('pending');

    // File 2 should be reviewed
    const file2Res = await app.request(`/api/files/${TEST_FILE_ID_2}`);
    const file2Body = await file2Res.json();
    expect(file2Body.file.status).toBe('reviewed');
  });
});

// ===== Review deletion cascades =====

describe('DELETE /api/review/:id (cascade)', () => {
  it('deletes review along with its files and annotations', async () => {
    // Create a review with a file and annotation
    const reviewId = 'cascade-delete-review';
    const fileId = 'cascade-delete-file';
    await testDb.query(
      `INSERT INTO reviews (id, repo_path, repo_name, mode, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [reviewId, TEST_REPO_ROOT, 'test-repo', 'uncommitted', 'completed']
    );
    await testDb.query(
      `INSERT INTO review_files (id, review_id, file_path, diff_data, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [fileId, reviewId, 'src/cascade.ts', '{}', 'pending']
    );
    await testDb.query(
      `INSERT INTO annotations (id, review_file_id, line_number, side, category, content)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['cascade-ann-1', fileId, 1, 'new', 'note', 'Will be cascaded']
    );

    // Delete the review
    const res = await app.request(`/api/review/${reviewId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    // Review should be gone
    const reviewCheck = await testDb.query('SELECT * FROM reviews WHERE id = $1', [reviewId]);
    expect(reviewCheck.rows.length).toBe(0);

    // Files should be gone
    const fileCheck = await testDb.query('SELECT * FROM review_files WHERE review_id = $1', [reviewId]);
    expect(fileCheck.rows.length).toBe(0);

    // Annotations should be gone
    const annCheck = await testDb.query('SELECT * FROM annotations WHERE review_file_id = $1', [fileId]);
    expect(annCheck.rows.length).toBe(0);
  });
});

// ===== Review query param override =====

describe('GET /api/review (query param override)', () => {
  it('returns null or empty for a non-existent reviewId query param', async () => {
    const res = await app.request('/api/review?reviewId=does-not-exist');
    // The route calls getReview which returns undefined; Hono's c.json(undefined)
    // will produce a 200 response — verify the response is not a valid review object
    expect(res.status).toBe(200);
    const text = await res.text();
    // undefined serializes as empty or "null"
    expect(text === '' || text === 'null' || text === 'undefined').toBe(true);
  });
});

// ===== Context expansion edge cases =====

describe('GET /api/context/:fileId (edge cases)', () => {
  it('handles start=1 and end=1 (single line)', async () => {
    const res = await app.request(`/api/context/${TEST_FILE_ID}?start=1&end=1`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.lines.length).toBe(1);
    expect(body.lines[0].num).toBe(1);
  });

  it('uses default range when start and end are omitted', async () => {
    const res = await app.request(`/api/context/${TEST_FILE_ID}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.lines)).toBe(true);
    // Default is start=1, end=20, but clamped to file length (5 lines)
    expect(body.lines.length).toBeGreaterThan(0);
  });

  it('clamps end beyond file length', async () => {
    const res = await app.request(`/api/context/${TEST_FILE_ID}?start=1&end=9999`);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Mock returns 'line1\nline2\nline3\nline4\nline5\n' which splits to 6 elements
    // (5 content lines + 1 trailing empty), clamped to allLines.length
    expect(body.lines.length).toBeLessThanOrEqual(6);
    expect(body.lines.length).toBeGreaterThan(0);
    // First line should start at 1
    expect(body.lines[0].num).toBe(1);
  });
});

// ===== GET /api/files with reviewId query param =====

describe('GET /api/files (with query params)', () => {
  it('returns files for a specific review via reviewId param', async () => {
    // The test review 2 has no files, so should return empty
    const res = await app.request(`/api/files?reviewId=${TEST_REVIEW_ID_2}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.files)).toBe(true);
    expect(body.files.length).toBe(0);
  });
});

// ===== Stale annotation flow =====

describe('Stale annotation lifecycle', () => {
  beforeEach(async () => {
    await testDb.query(
      `DELETE FROM annotations WHERE review_file_id IN ($1, $2)`,
      [TEST_FILE_ID, TEST_FILE_ID_2]
    );
  });

  it('stale annotations appear in stale counts but not in regular annotation counts', async () => {
    // Create two annotations: one normal, one stale
    const res1 = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 1,
        side: 'new',
        category: 'note',
        content: 'Normal annotation',
      }),
    });

    const res2 = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 2,
        side: 'new',
        category: 'bug',
        content: 'Will become stale',
      }),
    });
    const a2 = await res2.json();

    // Mark one as stale
    await testDb.query('UPDATE annotations SET is_stale = TRUE, original_content = $1 WHERE id = $2',
      ['old context', a2.id]);

    // Check file list counts
    const filesRes = await app.request('/api/files');
    const filesBody = await filesRes.json();

    // annotationCounts includes all annotations (stale and non-stale)
    expect(filesBody.annotationCounts[TEST_FILE_ID]).toBe(2);
    // staleCounts only counts stale ones
    expect(filesBody.staleCounts[TEST_FILE_ID]).toBe(1);
  });

  it('keeping a stale annotation preserves its content but clears stale metadata', async () => {
    const createRes = await app.request('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewFileId: TEST_FILE_ID,
        lineNumber: 5,
        side: 'new',
        category: 'fix',
        content: 'Important fix note',
      }),
    });
    const created = await createRes.json();

    // Mark stale
    await testDb.query(
      'UPDATE annotations SET is_stale = TRUE, original_content = $1 WHERE id = $2',
      ['old surrounding code', created.id]
    );

    // Keep it
    await app.request(`/api/annotations/${created.id}/keep`, { method: 'POST' });

    // Verify the annotation content is preserved but stale metadata is cleared
    const fileRes = await app.request(`/api/files/${TEST_FILE_ID}`);
    const fileBody = await fileRes.json();
    const kept = fileBody.annotations.find((a: { id: string }) => a.id === created.id);
    expect(kept.content).toBe('Important fix note');
    expect(kept.category).toBe('fix');
    expect(kept.is_stale).toBe(false);
  });

  it('delete-all stale only removes stale annotations, not non-stale ones', async () => {
    // Create 3 annotations: 2 stale, 1 not
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewFileId: TEST_FILE_ID,
          lineNumber: i + 1,
          side: 'new',
          category: 'note',
          content: `Annotation ${i}`,
        }),
      });
      const body = await res.json();
      ids.push(body.id);
    }

    // Mark first two as stale
    await testDb.query('UPDATE annotations SET is_stale = TRUE WHERE id IN ($1, $2)', [ids[0], ids[1]]);

    // Delete all stale
    const deleteRes = await app.request('/api/annotations/stale/delete-all', { method: 'POST' });
    expect(deleteRes.status).toBe(200);

    // Check: stale ones gone, non-stale remains
    const check0 = await testDb.query('SELECT * FROM annotations WHERE id = $1', [ids[0]]);
    expect(check0.rows.length).toBe(0);
    const check1 = await testDb.query('SELECT * FROM annotations WHERE id = $1', [ids[1]]);
    expect(check1.rows.length).toBe(0);
    const check2 = await testDb.query('SELECT * FROM annotations WHERE id = $1', [ids[2]]);
    expect(check2.rows.length).toBe(1);
  });
});

// GB-836 — `--diff foo.png foo.svg` returned an empty image-comparison panel
// because the route looked up `isSvgFile(file.file_path)`, which is always the
// new-side path; the content-type was decided from the wrong side. The fix
// decides per side.
//
// GB-932 — SVGs are no longer rasterized server-side: each side is served as
// raw bytes with the content-type of its *own* path, so an SVG side comes back
// as `image/svg+xml` and the browser renders it live (animations included).
describe('GET /api/image/:fileId/:side — side-aware content-type (GB-836, GB-932)', () => {
  const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
  const RENAME_FILE_ID = 'gb836-rename-file';

  function contentTypeForPath(p: string): string {
    if (p.endsWith('.png')) return 'image/png';
    if (p.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
  }

  beforeAll(async () => {
    await testDb.query(
      `INSERT INTO review_files (id, review_id, file_path, diff_data, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        RENAME_FILE_ID,
        TEST_REVIEW_ID,
        'demo-annotations.svg',
        JSON.stringify({
          filePath: 'demo-annotations.svg',
          oldPath: 'demo-annotations.png',
          status: 'renamed',
          hunks: [],
          isBinary: true,
        }),
        'pending',
      ],
    );
  });

  beforeEach(() => {
    vi.mocked(getOldImage).mockClear();
    vi.mocked(getNewImage).mockClear();
    // Route off the global mocks for this block — we need real path-based
    // decisions so we can verify the side-aware branching.
    vi.mocked(isSvgFile).mockImplementation((p: string) => p.endsWith('.svg'));
    vi.mocked(getContentType).mockImplementation(contentTypeForPath);
    vi.mocked(getOldImage).mockReturnValue({ data: PNG_BYTES, size: PNG_BYTES.length });
    vi.mocked(getNewImage).mockReturnValue({ data: SVG_BYTES, size: SVG_BYTES.length });
  });

  it('serves the old PNG side with the PNG content-type (from the side path, not file.file_path)', async () => {
    const res = await app.request(`/api/image/${RENAME_FILE_ID}/old`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(PNG_BYTES)).toBe(true);
  });

  it('serves the new SVG side as raw image/svg+xml for live browser rendering', async () => {
    const res = await app.request(`/api/image/${RENAME_FILE_ID}/new`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    const body = Buffer.from(await res.arrayBuffer());
    // The SVG bytes are passed through untouched — no rasterization.
    expect(body.equals(SVG_BYTES)).toBe(true);
  });

  it('also handles the inverse rename (SVG→PNG): old is SVG, new is PNG', async () => {
    const inverseId = 'gb836-rename-file-inverse';
    await testDb.query(
      `INSERT INTO review_files (id, review_id, file_path, diff_data, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        inverseId,
        TEST_REVIEW_ID,
        'icon.png',
        JSON.stringify({
          filePath: 'icon.png',
          oldPath: 'icon.svg',
          status: 'renamed',
          hunks: [],
          isBinary: true,
        }),
        'pending',
      ],
    );

    vi.mocked(getOldImage).mockReturnValue({ data: SVG_BYTES, size: SVG_BYTES.length });
    vi.mocked(getNewImage).mockReturnValue({ data: PNG_BYTES, size: PNG_BYTES.length });

    const oldRes = await app.request(`/api/image/${inverseId}/old`);
    expect(oldRes.status).toBe(200);
    expect(oldRes.headers.get('Content-Type')).toBe('image/svg+xml');

    const newRes = await app.request(`/api/image/${inverseId}/new`);
    expect(newRes.status).toBe(200);
    expect(newRes.headers.get('Content-Type')).toBe('image/png');
  });
});

describe('DELETE /api/review-notes/:guid (GB-907)', () => {
  it('responds ok with removed=false when the note is not on disk', async () => {
    const res = await app.request('/api/review-notes/some-guid?file=src/app.ts', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(false);
  });

  it('400s when the guid path param is empty', async () => {
    const res = await app.request('/api/review-notes/%20?file=src/app.ts', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/review-notes/artifact (GB-911)', () => {
  it('serves an image artifact with the right content-type', async () => {
    mkdirSync(`${TEST_REPO_ROOT}/.pr-notes/artifacts`, { recursive: true });
    writeFileSync(`${TEST_REPO_ROOT}/.pr-notes/artifacts/shot.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await app.request('/api/review-notes/artifact?file=.pr-notes/artifacts/shot.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('403s a path that escapes the repo', async () => {
    const res = await app.request('/api/review-notes/artifact?file=../../etc/passwd');
    expect(res.status).toBe(403);
  });

  it('415s a non-image extension', async () => {
    const res = await app.request('/api/review-notes/artifact?file=README.md');
    expect(res.status).toBe(415);
  });

  it('404s a missing image', async () => {
    const res = await app.request('/api/review-notes/artifact?file=.pr-notes/artifacts/missing.png');
    expect(res.status).toBe(404);
  });
});
