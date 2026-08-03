import { Hono } from 'hono';

import {
  deleteDatabaseBackup,
  listDatabaseBackups,
  listQuarantinedDirectories,
  resolvePreservedDirectory,
} from '../../db/backups.js';
import { getDbPath } from '../../db/connection.js';
import type { AppEnv } from '../../types.js';
import { openOS } from '../../utils/openOS.js';
import { errorResponse, requireSlugParam } from '../../utils/parseBody.js';

export const dbBackupRoutes = new Hono<AppEnv>();

// Retained pre-upgrade database backups (doc 9 §9.1a). The upgrade keeps a
// verified copy of the old cluster and never removes it on its own, so these
// two endpoints are the only way a user learns it exists and reclaims the space.
dbBackupRoutes.get('/db-backups', (c) => {
  const dbPath = getDbPath();
  // No data directory means nothing can exist yet; an empty list is the honest
  // answer and keeps the settings section simply not rendering.
  if (dbPath === null) return c.json({ backups: [], quarantined: [] });
  return c.json({
    backups: listDatabaseBackups(dbPath),
    quarantined: listQuarantinedDirectories(dbPath),
  });
});

dbBackupRoutes.delete('/db-backups/:name', (c) => {
  // `requireSlugParam`, not `requirePathParam`: this value reaches the
  // filesystem, and Hono percent-decodes params, so an encoded `..%2F` would
  // otherwise arrive intact (doc 14 FR-14.2). The prefix check inside
  // `deleteDatabaseBackup` is the second, independent layer.
  const name = requireSlugParam(c, 'name');
  if (!name.ok) return name.response;

  const dbPath = getDbPath();
  if (dbPath === null) return errorResponse(c, 'No data directory is set', 400);

  if (!deleteDatabaseBackup(dbPath, name.data)) {
    return errorResponse(c, `No such database backup: ${name.data}`, 404);
  }
  return c.json({ ok: true } as const);
});

// Reveal a set-aside directory in the OS file manager. Read-only, so unlike the
// delete above this also accepts a quarantined directory — the whole point is to
// let the user try to recover data Glassbox could not read (doc 9 §9.5).
dbBackupRoutes.post('/db-backups/:name/reveal', (c) => {
  const name = requireSlugParam(c, 'name');
  if (!name.ok) return name.response;

  const dbPath = getDbPath();
  if (dbPath === null) return errorResponse(c, 'No data directory is set', 400);

  const target = resolvePreservedDirectory(dbPath, name.data);
  if (target === null) return errorResponse(c, `No such directory: ${name.data}`, 404);

  try {
    openOS(target, 'reveal');
  } catch { /* best-effort, exactly like the file-row reveal in api/files.ts */ }
  return c.json({ ok: true } as const);
});
