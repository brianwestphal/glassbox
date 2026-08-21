/**
 * Integration test for GET /context/:fileId returning review notes for the
 * revealed range (doc 20 §20.6, GB-1139). Verifies the endpoint wiring: loads
 * the file's notes, re-anchors them to the range, hides stale ones, and returns
 * server-rendered note HTML keyed by line.
 */
import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_AI_SQL, SCHEMA_CORE_SQL } from '../../../src/db/ddl.js';
import type { AppEnv } from '../../../src/types.js';
import type { ReviewNoteView } from '../../../src/review-notes/view.js';

let testDb: PGlite;
const REVIEW_ID = 'ctx-review';
const FILE_ID = 'ctx-file';
const REPO = '/tmp/ctx-notes-repo';
const CONTENT = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

vi.mock('../../../src/db/connection.js', () => ({ getDb: async () => testDb }));

vi.mock('../../../src/git/diff.js', () => ({
  getModeFileContent: vi.fn(() => CONTENT),
  parseModeString: vi.fn(() => ({ type: 'uncommitted' })),
}));

// The notes a review carries — overridden per test.
let notesForFile: ReviewNoteView[] = [];
vi.mock('../../../src/review-notes/store.js', () => ({
  loadReviewNotesForFile: vi.fn(() => notesForFile),
}));

// Plugin artifact rendering is a no-op here (no plugins installed).
vi.mock('../../../src/plugins/artifacts.js', () => ({ renderNoteArtifacts: vi.fn(async () => { /* no-op */ }) }));

import { contextRoutes } from '../../../src/routes/api/context.js';

function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('reviewId', REVIEW_ID);
    c.set('currentReviewId', REVIEW_ID);
    c.set('repoRoot', REPO);
    await next();
  });
  app.route('/api', contextRoutes);
  return app;
}

let app: Hono<AppEnv>;

beforeAll(async () => {
  testDb = new PGlite();
  await testDb.exec(SCHEMA_CORE_SQL);
  await testDb.exec(SCHEMA_AI_SQL);
  await testDb.query(
    `INSERT INTO reviews (id, repo_path, repo_name, mode, status) VALUES ($1,$2,$3,$4,$5)`,
    [REVIEW_ID, REPO, 'r', 'uncommitted', 'in_progress'],
  );
  await testDb.query(
    `INSERT INTO review_files (id, review_id, file_path, diff_data, status) VALUES ($1,$2,$3,$4,$5)`,
    [FILE_ID, REVIEW_ID, 'src/a.ts', null, 'pending'],
  );
  app = createApp();
});

afterAll(async () => { await testDb.close(); });

beforeEach(() => { notesForFile = []; });

describe('GET /context/:fileId review notes (GB-1139)', () => {
  it('returns lines and no notes when the file has none', async () => {
    const res = await app.request(`/api/context/${FILE_ID}?start=1&end=10`);
    expect(res.status).toBe(200);
    const body = await res.json() as { lines: unknown[]; notes?: unknown[] };
    expect(body.lines.length).toBe(10);
    expect(body.notes).toBeUndefined();
  });

  it('returns server-rendered note HTML for a note anchored in the revealed range', async () => {
    notesForFile = [{ guid: 'n1', line: 3, side: 'new', kind: 'rationale', body: 'why line 3', snippet: 'line 3' }];
    const res = await app.request(`/api/context/${FILE_ID}?start=1&end=10`);
    const body = await res.json() as { notes?: { line: number; html: string }[] };
    expect(body.notes).toBeDefined();
    expect(body.notes).toHaveLength(1);
    expect(body.notes![0].line).toBe(3);
    expect(body.notes![0].html).toContain('ai-note-row');
    expect(body.notes![0].html).toContain('why line 3');
  });

  it('hides a stale note (snippet no longer matches the revealed code)', async () => {
    notesForFile = [{ guid: 'n1', line: 3, side: 'new', kind: 'rationale', body: 'x', snippet: 'gone code' }];
    const res = await app.request(`/api/context/${FILE_ID}?start=1&end=10`);
    const body = await res.json() as { notes?: unknown[] };
    expect(body.notes).toBeUndefined();
  });

  it('omits a note whose line falls outside the revealed range', async () => {
    notesForFile = [{ guid: 'n1', line: 9, side: 'new', kind: 'rationale', body: 'x', snippet: 'line 9' }];
    const res = await app.request(`/api/context/${FILE_ID}?start=1&end=5`);
    const body = await res.json() as { notes?: unknown[] };
    expect(body.notes).toBeUndefined();
  });
});
