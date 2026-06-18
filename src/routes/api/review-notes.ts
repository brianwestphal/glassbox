import { Hono } from 'hono';

import { removeNote } from '../../review-notes/store.js';
import type { AppEnv } from '../../types.js';
import { requirePathParam } from '../../utils/parseBody.js';

export const reviewNotesRoutes = new Hono<AppEnv>();

/** Discard an AI review note by its SARIF guid — removes it from the committed
 *  `.pr-notes/` store (GB-907, doc 20 §20.3). `?file=` scopes the shard search.
 *  `removed: false` when the note wasn't on disk (e.g. demo notes). */
reviewNotesRoutes.delete('/review-notes/:guid', (c) => {
  const guid = requirePathParam(c, 'guid');
  if (!guid.ok) return guid.response;
  const repoRoot = c.get('repoRoot');
  const file = c.req.query('file');
  const removed = removeNote(repoRoot, guid.data, file);
  return c.json({ ok: true, removed } as const);
});
