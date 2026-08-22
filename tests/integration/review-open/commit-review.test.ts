/**
 * Integration test for runtime "open a commit as a review" (doc 34, GB-1144):
 * `openCommitReview` against a real temp git repo + the in-memory test DB.
 */
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setupTestDb, teardownTestDb } from '../../helpers/db.js';

vi.mock('../../../src/db/connection.js', () => ({ getDb: vi.fn() }));

import { getDb } from '../../../src/db/connection.js';
import { getReviewFiles, updateReviewStatus } from '../../../src/db/queries.js';
import { CommitNotFoundError, openCommitReview } from '../../../src/review-open/commit-review.js';

function git(repo: string, args: string): string {
  return execSync(`git ${args}`, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

describe('openCommitReview (doc 34)', () => {
  let repo: string;
  let sha: string;

  beforeAll(async () => {
    const db = await setupTestDb();
    vi.mocked(getDb).mockResolvedValue(db);

    repo = mkdtempSync(join(tmpdir(), 'gb-commit-review-'));
    git(repo, 'init -q');
    git(repo, 'config user.email test@example.com');
    git(repo, 'config user.name Test');
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n');
    git(repo, 'add .');
    git(repo, 'commit -q -m first');
    // Second commit: modify a.txt + add b.txt — this is the commit we open.
    writeFileSync(join(repo, 'a.txt'), 'one\nCHANGED\nthree\n');
    writeFileSync(join(repo, 'b.txt'), 'brand new\n');
    git(repo, 'add .');
    git(repo, 'commit -q -m second');
    sha = git(repo, 'rev-parse HEAD').trim();
  });

  afterAll(async () => {
    await teardownTestDb();
    rmSync(repo, { recursive: true, force: true });
  });

  it('creates a review for the commit with its changed files', async () => {
    const res = await openCommitReview(repo, sha);
    expect(res.created).toBe(true);
    expect(res.reviewId).toBeTruthy();
    expect(res.fileCount).toBe(2);
    const files = await getReviewFiles(res.reviewId);
    expect(files.map(f => f.file_path).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('reuses the existing in-progress review on a second open of the same commit', async () => {
    const first = await openCommitReview(repo, sha);
    const second = await openCommitReview(repo, sha);
    expect(second.created).toBe(false);
    expect(second.reviewId).toBe(first.reviewId);
  });

  it('resolves an abbreviated sha the same as the full one', async () => {
    const short = sha.slice(0, 8);
    const res = await openCommitReview(repo, short);
    // Same commit → the same existing review is reused.
    expect(res.created).toBe(false);
  });

  it('reuses even a COMPLETED review of the same commit rather than creating a fresh one (GB-1149)', async () => {
    const first = await openCommitReview(repo, sha);
    await updateReviewStatus(first.reviewId, 'completed');
    const second = await openCommitReview(repo, sha);
    expect(second.created).toBe(false);
    expect(second.reviewId).toBe(first.reviewId);
  });

  it('throws CommitNotFoundError for an unknown sha', async () => {
    await expect(openCommitReview(repo, '0000000000000000000000000000000000000000'))
      .rejects.toBeInstanceOf(CommitNotFoundError);
  });
});
