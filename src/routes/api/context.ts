import { Hono } from 'hono';

import { GetContextLinesQuerySchema } from '../../api/context.js';
import { getReview, getReviewFile } from '../../db/queries.js';
import { getModeFileContent, parseModeString } from '../../git/diff.js';
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
  return c.json({ lines });
});
