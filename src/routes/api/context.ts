import { Hono } from 'hono';

import { GetContextLinesQuerySchema } from '../../api/context.js';
import { getAnnotationsForFile, getReview, getReviewFile } from '../../db/queries.js';
import { getDemoMode } from '../../debug.js';
import { demoReviewNotes } from '../../demo.js';
import { getModeFileContent, parseModeString } from '../../git/diff.js';
import { renderNoteArtifacts } from '../../plugins/artifacts.js';
import { reanchorNotesForRange, renderContextNotes } from '../../review-notes/context-notes.js';
import { loadReviewNotesForFile } from '../../review-notes/store.js';
import type { AppEnv } from '../../types.js';
import { parseQuery, requirePathParam } from '../../utils/parseBody.js';

export const contextRoutes = new Hono<AppEnv>();

contextRoutes.get('/context/:fileId', async (c) => {
  const repoRoot = c.get('repoRoot');
  const fileId = requirePathParam(c, 'fileId');
  if (!fileId.ok) return fileId.response;
  const file = await getReviewFile(fileId.data);
  if (!file) return c.json({ error: 'Not found' }, 404);

  const parsed = parseQuery(c, GetContextLinesQuerySchema);
  if (!parsed.ok) return parsed.response;
  const { start, end } = parsed.data;

  // Expanded context tracks the new-side line numbers (doc 18, FR-18.5).
  const review = await getReview(file.review_id);
  const mode = review ? parseModeString(review.mode) : { type: 'uncommitted' as const };
  const content = getModeFileContent(mode, file.file_path, 'new', repoRoot);
  const allLines = content.split('\n');
  const clampedStart = Math.max(1, start);
  const clampedEnd = Math.min(allLines.length, end);
  const lines = [];
  for (let i = clampedStart; i <= clampedEnd; i++) {
    lines.push({ num: i, content: allLines[i - 1] || '' });
  }

  // Review notes anchored inside the revealed range (doc 20 §20.6, GB-1139):
  // render them so "show remaining lines" surfaces previously-hidden notes.
  // Stale notes (snippet no longer matches the revealed code) are excluded here
  // — the "hide stale" choice for this reveal path. Demo mode serves synthetic
  // notes; a real review reads `.pr-notes/`.
  const rawNotes = getDemoMode() !== null
    ? demoReviewNotes(file.file_path)
    : loadReviewNotesForFile(repoRoot, file.file_path);
  let notes: { line: number; html: string }[] | undefined;
  if (rawNotes.length > 0) {
    const anchored = reanchorNotesForRange(rawNotes, file.file_path, clampedStart, clampedEnd, lines);
    if (anchored.length > 0) {
      // Match the /file view: offer diagram-source artifacts to content plugins.
      await renderNoteArtifacts(anchored);
      const rendered = renderContextNotes(anchored, await getAnnotationsForFile(file.id));
      if (rendered.length > 0) notes = rendered;
    }
  }

  return c.json({ lines, ...(notes ? { notes } : {}) });
});
