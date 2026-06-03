/**
 * Integration tests for the accumulating `git difftool` session endpoints
 * (doc 19): append → live poll → end. Uses an in-memory PGLite database and
 * Hono's request testing (no real HTTP server), with the session's `shutdown`
 * stubbed so teardown doesn't exit the test runner.
 *
 * `diffRawContent` runs the real `git diff --no-index` engine, so git must be
 * on PATH (it is in CI and dev).
 */
import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_CORE_SQL, SCHEMA_AI_SQL } from '../../../src/db/schema.js';
import type { AppEnv } from '../../../src/types.js';

let testDb: PGlite;
const REVIEW_ID = 'difftool-review-001';
const REPO_ROOT = `${tmpdir()}/glassbox-difftool-test`;

vi.mock('../../../src/db/connection.js', () => ({
  getDb: async () => testDb,
}));

// Import after the DB mock is registered (vi.mock is hoisted). The difftool
// routes pull in the real session module + real git/diff (intentionally — we
// want diffRawContent's actual behavior).
import { difftoolApiRoutes } from '../../../src/routes/difftool-api.js';
import {
  endDifftoolSession,
  getDifftoolSession,
  initDifftoolSession,
  resetDifftoolSessionForTest,
} from '../../../src/difftool/session.js';

function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('reviewId', REVIEW_ID);
    c.set('currentReviewId', REVIEW_ID);
    c.set('repoRoot', REPO_ROOT);
    await next();
  });
  app.route('/api/difftool', difftoolApiRoutes);
  return app;
}

const b64 = (s: string): string => Buffer.from(s, 'utf-8').toString('base64');

let app: Hono<AppEnv>;
const shutdown = vi.fn();

beforeAll(async () => {
  testDb = new PGlite();
  await testDb.waitReady;
  await testDb.exec(SCHEMA_CORE_SQL);
  await testDb.exec(SCHEMA_AI_SQL);
  app = createApp();
});

afterAll(async () => {
  if (testDb) await testDb.close();
});

beforeEach(async () => {
  resetDifftoolSessionForTest();
  shutdown.mockClear();
  await testDb.query('DELETE FROM review_files WHERE review_id = $1', [REVIEW_ID]);
  await testDb.query('DELETE FROM reviews WHERE id = $1', [REVIEW_ID]);
  await testDb.query(
    `INSERT INTO reviews (id, repo_path, repo_name, mode, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [REVIEW_ID, REPO_ROOT, 'git difftool', 'difftool', 'in_progress'],
  );
  initDifftoolSession({ reviewId: REVIEW_ID, repoRoot: REPO_ROOT, shutdown });
});

async function append(path: string, oldContent: string, newContent: string): Promise<Response> {
  return app.request('/api/difftool/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, oldContentB64: b64(oldContent), newContentB64: b64(newContent) }),
  });
}

describe('GET /api/difftool/ping', () => {
  it('reports the live session', async () => {
    const res = await app.request('/api/difftool/ping');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, active: true });
  });
});

describe('POST /api/difftool/append', () => {
  it('accumulates files into the active review', async () => {
    const r1 = await append('src/a.ts', 'a\n', 'a\nb\n');
    expect(r1.status).toBe(200);
    const j1 = (await r1.json()) as { ok: boolean; fileId: string };
    expect(j1.ok).toBe(true);
    expect(j1.fileId).toBeTruthy();

    await append('src/b.ts', 'x\n', 'y\n');

    const files = await testDb.query('SELECT file_path FROM review_files WHERE review_id = $1 ORDER BY file_path', [REVIEW_ID]);
    expect(files.rows.map((r) => (r as { file_path: string }).file_path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('de-duplicates by path (re-append updates in place)', async () => {
    const first = (await (await append('src/a.ts', 'a\n', 'b\n')).json()) as { fileId: string };
    const second = (await (await append('src/a.ts', 'a\n', 'c\n')).json()) as { fileId: string };
    expect(second.fileId).toBe(first.fileId);
    const count = await testDb.query('SELECT COUNT(*)::int AS n FROM review_files WHERE review_id = $1', [REVIEW_ID]);
    expect((count.rows[0] as { n: number }).n).toBe(1);
  });

  it('rejects an append when there is no active session', async () => {
    endDifftoolSession();
    const res = await append('src/a.ts', 'a\n', 'b\n');
    expect(res.status).toBe(409);
  });
});

describe('GET /api/difftool/poll', () => {
  it('returns the growing file list while active', async () => {
    await append('src/a.ts', 'a\n', 'b\n');
    const res = await app.request('/api/difftool/poll');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { active: boolean; files: { file_path: string }[] };
    expect(json.active).toBe(true);
    expect(json.files.map((f) => f.file_path)).toEqual(['src/a.ts']);
  });

  it('reports active:false once the session has ended', async () => {
    const res = await app.request('/api/difftool/poll');
    const before = (await res.json()) as { active: boolean };
    expect(before.active).toBe(true);

    endDifftoolSession();
    const after = (await (await app.request('/api/difftool/poll')).json()) as { active: boolean };
    expect(after.active).toBe(false);
  });
});

describe('POST /api/difftool/end', () => {
  it('ends the session', async () => {
    expect(getDifftoolSession()).not.toBeNull();
    const res = await app.request('/api/difftool/end', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(getDifftoolSession()).toBeNull();
  });
});
