import { Hono } from 'hono';

import { AppendDifftoolFileReqSchema, RegisterDifftoolReqSchema } from '../api/index.js';
import { getDataDir } from '../db/connection.js';
import { addReviewFile, getAnnotationCountsForReview, getReviewFiles, updateFileDiff } from '../db/queries.js';
import {
  addDifftoolHold,
  endDifftoolSession,
  getDifftoolSession,
  noteDifftoolActivity,
} from '../difftool/session.js';
import { diffRawContent } from '../git/diff.js';
import { getDifftoolStatus, registerDifftool, unregisterDifftool } from '../git/difftool.js';
import { isSvgFile } from '../git/image.js';
import { writeImageBlob } from '../git/image-blobs.js';
import type { AppEnv } from '../types.js';
import { errorResponse, parseBody } from '../utils/parseBody.js';

/**
 * GB-850 — settings-dialog API for the `git difftool` registration. Mirrors
 * the CLI `--register-difftool` / `--unregister-difftool` flags. Always
 * operates at `--global` scope (the settings dialog is "what affects every
 * repo I use"); the per-repo `--local` flag stays CLI-only.
 */
export const difftoolApiRoutes = new Hono<AppEnv>();

/** GET /difftool/status — current `diff.tool` + cmd + glassbox-match flag. */
difftoolApiRoutes.get('/status', (c) => {
  return c.json(getDifftoolStatus('global'));
});

// POST /difftool/register — body: { force?: boolean }.
difftoolApiRoutes.post('/register', async (c) => {
  const parsed = await parseBody(c, RegisterDifftoolReqSchema);
  if (!parsed.ok) return parsed.response;
  return c.json(registerDifftool({ scope: 'global', force: parsed.data.force === true }));
});

/** POST /difftool/unregister — no body. */
difftoolApiRoutes.post('/unregister', (c) => {
  return c.json(unregisterDifftool({ scope: 'global' }));
});

// --- Accumulating difftool session (doc 19) ---

/** GET /difftool/ping — readiness probe for the wrapper's discover-or-start
 *  loop (FR-19.12). Answers only once the session is live. */
difftoolApiRoutes.get('/ping', (c) => {
  const session = getDifftoolSession();
  if (session === null) return c.json({ ok: true, active: false });
  noteDifftoolActivity();
  return c.json({ ok: true, active: true });
});

/**
 * POST /difftool/append — append one file (raw base64 content) to the active
 * session's review (FR-19.7). De-duplicates by display path so a re-run that
 * re-sends a file updates its diff in place rather than piling up duplicates.
 */
difftoolApiRoutes.post('/append', async (c) => {
  const session = getDifftoolSession();
  if (session === null) return errorResponse(c, 'No active difftool session', 409);
  const parsed = await parseBody(c, AppendDifftoolFileReqSchema);
  if (!parsed.ok) return parsed.response;
  noteDifftoolActivity();

  const oldContent = Buffer.from(parsed.data.oldContentB64, 'base64');
  const newContent = Buffer.from(parsed.data.newContentB64, 'base64');
  const diff = diffRawContent(parsed.data.path, oldContent, newContent);
  const diffData = JSON.stringify(diff);

  const existing = (await getReviewFiles(session.reviewId)).find((f) => f.file_path === diff.filePath);
  let fileId: string;
  if (existing !== undefined) {
    await updateFileDiff(existing.id, diffData);
    fileId = existing.id;
  } else {
    const file = await addReviewFile(session.reviewId, diff.filePath, diffData);
    fileId = file.id;
  }

  // GB-863 — persist the raw bytes for image/SVG files so the /image route can
  // serve them. A difftool review has no git refs / working tree to re-read, so
  // without this the visual comparison (metadata/difference/slice, SVG rendered)
  // has no source bytes. Text diffs render from diff_data and need nothing here.
  if (diff.isBinary || isSvgFile(diff.filePath)) {
    const dataDir = getDataDir();
    if (dataDir !== null) {
      writeImageBlob(dataDir, fileId, 'old', oldContent);
      writeImageBlob(dataDir, fileId, 'new', newContent);
    }
  }

  return c.json({ ok: true, fileId });
});

/** GET /difftool/poll — live file list for the client sidebar (FR-19.8), plus
 *  an `active` flag the client uses to detect end-of-session. */
difftoolApiRoutes.get('/poll', async (c) => {
  const session = getDifftoolSession();
  if (session === null) {
    return c.json({ active: false, files: [], annotationCounts: {}, staleCounts: {} });
  }
  noteDifftoolActivity();
  const [files, annotationCounts] = await Promise.all([
    getReviewFiles(session.reviewId),
    getAnnotationCountsForReview(session.reviewId),
  ]);
  // A difftool session never re-diffs against a moving HEAD, so annotations
  // can't go stale — staleCounts is always empty here.
  return c.json({ active: true, files, annotationCounts, staleCounts: {} });
});

/**
 * GET /difftool/hold — the last-file wrapper holds this connection open so
 * `git difftool` stays attached to the terminal (FR-19.5). It resolves when the
 * session ends (Done / tab close); if the wrapper is killed (Ctrl-C) the socket
 * aborts and the server tears the session down.
 */
difftoolApiRoutes.get('/hold', (c) => {
  const session = getDifftoolSession();
  if (session === null) return c.json({ ended: true });
  noteDifftoolActivity();
  return new Promise<Response>((resolve) => {
    addDifftoolHold(() => { resolve(c.json({ ended: true })); });
    // Client (wrapper) disconnect — e.g. Ctrl-C — ends the whole session.
    c.req.raw.signal.addEventListener('abort', () => { endDifftoolSession(); });
  });
});

/** POST /difftool/end — end the session ("Done" button, or `sendBeacon` on tab
 *  close). No body required so a beacon with an empty payload works. */
difftoolApiRoutes.post('/end', (c) => {
  endDifftoolSession();
  return c.json({ ok: true });
});
