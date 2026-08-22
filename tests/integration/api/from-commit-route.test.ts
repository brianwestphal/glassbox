/**
 * Route-level integration test for `POST /api/reviews/from-commit` (doc 34,
 * GB-1144 / GB-1149): the HTTP seam the client's "Open commit" button hits —
 * parseBody validation, the openCommitReview call against a real git repo, and
 * the success / 404 / 400 response mapping. The helper itself is covered in
 * `commit-review.test.ts`; this covers the route wiring around it.
 */
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { Hono } from 'hono';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setupTestDb, teardownTestDb } from '../../helpers/db.js';

vi.mock('../../../src/db/connection.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../../../src/db/connection.js';
import { reviewsRoutes } from '../../../src/routes/api/reviews.js';
import type { AppEnv } from '../../../src/types.js';

function git(repo: string, args: string): string {
  return execSync(`git ${args}`, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

describe('POST /api/reviews/from-commit (doc 34)', () => {
  let repo: string;
  let sha: string;
  let app: Hono<AppEnv>;

  beforeAll(async () => {
    const db = await setupTestDb();
    vi.mocked(getDb).mockResolvedValue(db);

    repo = mkdtempSync(join(tmpdir(), 'gb-from-commit-route-'));
    git(repo, 'init -q');
    git(repo, 'config user.email test@example.com');
    git(repo, 'config user.name Test');
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
    git(repo, 'add .');
    git(repo, 'commit -q -m first');
    writeFileSync(join(repo, 'a.txt'), 'one\nCHANGED\n');
    git(repo, 'add .');
    git(repo, 'commit -q -m second');
    sha = git(repo, 'rev-parse HEAD').trim();

    app = new Hono<AppEnv>();
    app.use('*', async (c, next) => { c.set('repoRoot', repo); await next(); });
    app.route('/api', reviewsRoutes);
  });

  afterAll(async () => {
    await teardownTestDb();
    rmSync(repo, { recursive: true, force: true });
  });

  it('creates a review and returns its id for a real commit (200)', async () => {
    const res = await app.request('/api/reviews/from-commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { reviewId: string; fileCount: number; created: boolean };
    expect(body.reviewId).toBeTruthy();
    expect(body.fileCount).toBe(1);
    expect(body.created).toBe(true);
  });

  it('reuses the review on a second call (created: false)', async () => {
    const res = await app.request('/api/reviews/from-commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { created: boolean };
    expect(body.created).toBe(false);
  });

  it('returns 404 for an unresolvable sha', async () => {
    const res = await app.request('/api/reviews/from-commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: '0000000000000000000000000000000000000000' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for a missing/empty sha (parseBody validation)', async () => {
    const res = await app.request('/api/reviews/from-commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: '' }),
    });
    expect(res.status).toBe(400);
  });
});
