import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { getDataDir } from '../db/connection.js';

/**
 * On-disk storage for reviewer-uploaded attachment files (doc 25). Bytes live
 * under `<dataDir>/attachments/`, named `<id>-<safe original name>` so the file
 * keeps a recognizable name (and extension, which drives the OS Quick Look /
 * default-opener handler) while staying collision-free per attachment id.
 *
 * The DB `attachments` table holds the metadata + the absolute `stored_path`;
 * this module only touches the filesystem.
 */

export function attachmentsDir(): string | null {
  const dataDir = getDataDir();
  return dataDir === null ? null : join(dataDir, 'attachments');
}

/** Strip path separators and control/reserved characters so a user-supplied
 *  filename can't escape the attachments dir or break the OS. Keeps a sensible
 *  fallback when the whole name sanitizes away. */
export function sanitizeFilename(name: string): string {
  // Normalize Windows separators so `basename` takes the last path segment for
  // either OS's separator, then drop any control/reserved characters.
  const base = basename(name.replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f<>:"|?*/\\]/g, '').trim();
  return cleaned === '' ? 'attachment' : cleaned.slice(0, 200);
}

export interface StoredAttachment {
  storedPath: string;
  size: number;
  sha256: string;
}

/** Persist one attachment's bytes; returns the absolute path, size, and hash.
 *  Throws if there's no data dir (no active review). */
export function writeAttachmentFile(id: string, originalFilename: string, bytes: Buffer): StoredAttachment {
  const dir = attachmentsDir();
  if (dir === null) throw new Error('No data directory for attachments');
  mkdirSync(dir, { recursive: true });
  const storedPath = join(dir, `${id}-${sanitizeFilename(originalFilename)}`);
  writeFileSync(storedPath, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { storedPath, size: bytes.length, sha256 };
}

/** Best-effort removal of an attachment's bytes from disk. */
export function deleteAttachmentFile(storedPath: string): void {
  try {
    if (existsSync(storedPath)) rmSync(storedPath, { force: true });
  } catch {
    /* best-effort — a missing/locked file shouldn't block the DB delete */
  }
}
