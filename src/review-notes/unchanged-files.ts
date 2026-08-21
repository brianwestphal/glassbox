import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { unchangedFileDiff } from '../git/parseDiffData.js';
import type { FileDiff } from '../git/types.js';
import { noteSourceForShardPath } from './store.js';

/** A file surfaced in a review only because it carries AI review notes. */
export interface NoteOnlyFile {
  filePath: string;
  diff: FileDiff;
}

/**
 * Files whose AI review notes are part of *this review's* change set but whose
 * own source wasn't changed — so the review can still surface those notes (doc
 * 20 §20.6, GB-1137). Each is returned with an `unchanged` `FileDiff` whose
 * single hunk is the whole current file as context lines, so the notes anchor
 * inline.
 *
 * The scope is deliberately the review's diff, NOT every file that has ever had
 * a note on disk: an AI writes a note in the same changeset as the work, so the
 * note shard (`.pr-notes/notes/<src>.NNNNNN.sarif`) appears in the diff exactly
 * when its note belongs to this review. We map each such shard back to `<src>`
 * and surface it if it wasn't itself changed.
 *
 * `diffs` is the review's full changed-file set. Skips: a shard that was deleted
 * (the note is gone), a source already among the changed files, the `.pr-notes/`
 * store itself, and a source that no longer exists or can't be read as text —
 * dropped rather than failing the launch.
 */
export function collectNoteOnlyFiles(repoRoot: string, diffs: FileDiff[]): NoteOnlyFile[] {
  const changed = new Set(diffs.map(d => d.filePath));
  // Source paths whose note shard is added/modified in this review's diff.
  const notedSources = new Set<string>();
  for (const d of diffs) {
    if (d.status === 'deleted') continue;
    const src = noteSourceForShardPath(d.filePath);
    if (src !== null) notedSources.add(src);
  }

  const out: NoteOnlyFile[] = [];
  for (const src of notedSources) {
    if (changed.has(src) || src.startsWith('.pr-notes/')) continue;
    const abs = join(repoRoot, src);
    if (!existsSync(abs)) continue;
    let content: string;
    try {
      content = readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    out.push({ filePath: src, diff: unchangedFileDiff(src, content) });
  }
  return out;
}
