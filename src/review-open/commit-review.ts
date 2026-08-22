/**
 * Runtime "open a commit as a review" (doc 34, GB-1144).
 *
 * The CLI is normally the only thing that creates reviews (`launchReview` in
 * `src/cli.ts`). This helper lets a running server create — or reuse — a review
 * for an arbitrary commit on demand, so a review note's origin-commit label can
 * offer an "open this commit as a review" jump (see its file+line in the exact
 * context it was written for). It reuses the same create-and-populate body as
 * `launchReview` (`getFileDiffs({type:'commit'}) → createReview → addReviewFile`,
 * plus the note-only files of doc 20 §20.6), and de-dupes via
 * `getLatestInProgressReview` so re-opening the same commit reuses the record.
 */
import { addReviewFile, createReview, getLatestInProgressReview, getReviewFiles } from '../db/queries.js';
import { getFileDiffs, getModeArgs, getModeString } from '../git/diff.js';
import { getRepoName, resolveCommitSha } from '../git/repo.js';
import type { ReviewMode } from '../git/types.js';
import { collectNoteOnlyFiles } from '../review-notes/unchanged-files.js';

export interface OpenCommitReviewResult {
  reviewId: string;
  /** Number of files in the review (diffed files + note-only files). */
  fileCount: number;
  /** false when an existing in-progress review for this commit was reused. */
  created: boolean;
}

export class CommitNotFoundError extends Error {}

/**
 * Create (or reuse) a review for `sha` in `repoRoot` and return its id.
 *
 * Throws `CommitNotFoundError` if `sha` does not resolve to a commit in the repo.
 */
export async function openCommitReview(repoRoot: string, sha: string): Promise<OpenCommitReviewResult> {
  // Validate + canonicalize the sha before doing any work: a bad ref would
  // otherwise silently produce an empty diff and a confusing empty review, and
  // canonicalizing to the full 40-char sha makes the `commit:<sha>` mode string
  // stable so opening the same commit via different spellings reuses one review.
  const fullSha = resolveCommitSha(repoRoot, sha);
  if (fullSha === null) {
    throw new CommitNotFoundError(`Commit not found: ${sha}`);
  }

  const mode: ReviewMode = { type: 'commit', sha: fullSha };
  const modeStr = getModeString(mode);
  const modeArgs = getModeArgs(mode);

  // Reuse an in-progress review for the exact same commit (same mode string), so
  // repeated jumps to a commit land on the same review rather than piling up
  // duplicates. Matches `launchReview`'s in-progress reuse.
  const existing = await getLatestInProgressReview(repoRoot, modeStr, modeArgs);
  if (existing !== undefined) {
    const files = await getReviewFiles(existing.id);
    return { reviewId: existing.id, fileCount: files.length, created: false };
  }

  const repoName = getRepoName(repoRoot);
  const diffs = getFileDiffs(mode, repoRoot);

  // headCommit is the reviewed commit itself (the CLI uses current HEAD, but for
  // an on-demand commit open the commit sha is the meaningful "as of" marker).
  const review = await createReview(repoRoot, repoName, modeStr, modeArgs, fullSha);

  let fileCount = 0;
  for (const diff of diffs) {
    await addReviewFile(review.id, diff.filePath, JSON.stringify(diff), null);
    fileCount++;
  }

  // Surface files whose AI review notes are in this commit's change set but whose
  // own source wasn't changed, as `unchanged` files (doc 20 §20.6, GB-1137), so
  // those notes stay reachable — the same treatment `launchReview` gives.
  const noteOnly = collectNoteOnlyFiles(repoRoot, diffs);
  for (const { filePath, diff } of noteOnly) {
    await addReviewFile(review.id, filePath, JSON.stringify(diff), null);
    fileCount++;
  }

  return { reviewId: review.id, fileCount, created: true };
}
