import { readFileSync, statSync } from 'fs';
import { Hono } from 'hono';
import { extname, relative, resolve } from 'path';

import { removeNote } from '../../review-notes/store.js';
import type { AppEnv } from '../../types.js';
import { requirePathParam } from '../../utils/parseBody.js';

export const reviewNotesRoutes = new Hono<AppEnv>();

const ARTIFACT_SERVE_MAX_BYTES = 10_000_000;
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
};

/** Serve a binary image artifact's bytes by repo-relative path (doc 20 §20.5
 *  P4c). Path-contained to the repo; image content-types only; size-capped. */
reviewNotesRoutes.get('/review-notes/artifact', (c) => {
  const file = c.req.query('file');
  if (file === undefined || file === '') return c.text('Missing file', 400);

  const repoRoot = c.get('repoRoot');
  const abs = resolve(repoRoot, file);
  const rel = relative(repoRoot, abs);
  if (rel === '' || rel.startsWith('..') || rel.startsWith('/')) return c.text('Forbidden', 403);

  const ext = extname(abs).toLowerCase();
  if (!(ext in IMAGE_CONTENT_TYPES)) return c.text('Unsupported artifact type', 415);
  const contentType = IMAGE_CONTENT_TYPES[ext];

  try {
    const stat = statSync(abs); // throws if absent → caught below
    if (!stat.isFile() || stat.size > ARTIFACT_SERVE_MAX_BYTES) return c.text('Not found', 404);
    const body = readFileSync(abs);
    return c.body(body, 200, { 'Content-Type': contentType });
  } catch {
    return c.text('Not found', 404);
  }
});

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
