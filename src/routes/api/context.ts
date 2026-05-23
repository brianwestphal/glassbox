import { Hono } from 'hono';

import { GetContextLinesQuerySchema } from '../../api/context.js';
import { getReviewFile } from '../../db/queries.js';
import { getFileContent } from '../../git/diff.js';
import type { AppEnv } from '../../types.js';
import { parseQuery } from '../../utils/parseBody.js';

export const contextRoutes = new Hono<AppEnv>();

contextRoutes.get('/context/:fileId', async (c) => {
  const repoRoot = c.get('repoRoot');
  const file = await getReviewFile(c.req.param('fileId'));
  if (!file) return c.json({ error: 'Not found' }, 404);

  const parsed = parseQuery(c, GetContextLinesQuerySchema);
  if (!parsed.ok) return parsed.response;
  const { start, end } = parsed.data;

  const content = getFileContent(file.file_path, 'working', repoRoot);
  const allLines = content.split('\n');
  const clampedStart = Math.max(1, start);
  const clampedEnd = Math.min(allLines.length, end);
  const lines = [];
  for (let i = clampedStart; i <= clampedEnd; i++) {
    lines.push({ num: i, content: allLines[i - 1] || '' });
  }
  return c.json({ lines });
});
