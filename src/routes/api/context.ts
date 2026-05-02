import { Hono } from 'hono';

import { getReviewFile } from '../../db/queries.js';
import { getFileContent } from '../../git/diff.js';
import type { AppEnv } from '../../types.js';

export const contextRoutes = new Hono<AppEnv>();

contextRoutes.get('/context/:fileId', async (c) => {
  const repoRoot = c.get('repoRoot');
  const file = await getReviewFile(c.req.param('fileId'));
  if (!file) return c.json({ error: 'Not found' }, 404);

  const startLine = parseInt(c.req.query('start') ?? '1', 10);
  const endLine = parseInt(c.req.query('end') ?? '20', 10);

  const content = getFileContent(file.file_path, 'working', repoRoot);
  const allLines = content.split('\n');
  const clampedStart = Math.max(1, startLine);
  const clampedEnd = Math.min(allLines.length, endLine);
  const lines = [];
  for (let i = clampedStart; i <= clampedEnd; i++) {
    lines.push({ num: i, content: allLines[i - 1] || '' });
  }
  return c.json({ lines });
});
