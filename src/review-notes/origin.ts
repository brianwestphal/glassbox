import { getCommitInfo } from '../git/repo.js';
import type { ReviewNoteView } from './view.js';

/**
 * Fill each note's `origin.subject` / `origin.message` from git (docs/20 §20.6,
 * GB-1142). The store carries only the commit `sha`/`shortSha` (from SARIF
 * provenance); this resolves the human-readable subject + full message so the
 * diff can render the provenance label without git access in the render layer.
 *
 * Mutates the notes in place (same pattern as `renderNoteArtifacts`). Resolves
 * each distinct sha once (cached). A note whose `origin.subject` is already set
 * (e.g. demo notes) is left alone; a sha git can't resolve (bad/synthetic, or a
 * different clone) is left with just the short hash, so the label degrades to
 * the hash alone rather than failing.
 */
export function resolveNoteOrigins(repoRoot: string, notes: ReviewNoteView[]): void {
  const cache = new Map<string, { shortSha: string; subject: string; message: string } | null>();
  for (const n of notes) {
    if (n.origin === undefined || n.origin.subject !== undefined) continue;
    const sha = n.origin.sha;
    let info = cache.get(sha);
    if (info === undefined) {
      info = getCommitInfo(repoRoot, sha);
      cache.set(sha, info);
    }
    if (info !== null) {
      n.origin.shortSha = info.shortSha;
      n.origin.subject = info.subject;
      n.origin.message = info.message;
    }
  }
}
