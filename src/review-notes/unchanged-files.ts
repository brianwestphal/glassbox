import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { unchangedFileDiff } from '../git/parseDiffData.js';
import type { FileDiff } from '../git/types.js';
import { listFilesWithNotes } from './store.js';

/** A file surfaced in a review only because it carries AI review notes. */
export interface NoteOnlyFile {
  filePath: string;
  diff: FileDiff;
}

/**
 * Files that carry AI review notes (doc 20) but are NOT among the changed files,
 * so a review can still surface their notes (doc 20 §20.6, GB-1137). Each is
 * returned with an `unchanged` `FileDiff` whose single hunk is the whole current
 * file as context lines, so the notes anchor inline.
 *
 * Skips: files already in `changedPaths`, the `.pr-notes/` note store itself,
 * and any note whose source file no longer exists or can't be read as text
 * (a since-deleted or binary file) — those are dropped rather than failing the
 * launch. Returns `[]` when the repo has no notes tree.
 */
export function collectNoteOnlyFiles(repoRoot: string, changedPaths: Set<string>): NoteOnlyFile[] {
  const out: NoteOnlyFile[] = [];
  for (const filePath of listFilesWithNotes(repoRoot)) {
    if (changedPaths.has(filePath) || filePath.startsWith('.pr-notes/')) continue;
    const abs = join(repoRoot, filePath);
    if (!existsSync(abs)) continue;
    let content: string;
    try {
      content = readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    out.push({ filePath, diff: unchangedFileDiff(filePath, content) });
  }
  return out;
}
