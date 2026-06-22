import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * On-disk storage for the raw image/SVG bytes of a review whose files have no
 * git refs and no working tree to re-read from.
 *
 * The image-comparison routes (`src/routes/api/image.ts`) normally re-fetch a
 * file's bytes from git or the working tree (`getOldImage`/`getNewImage`). Two
 * review kinds have neither:
 *
 *   - an accumulating `git difftool` session (doc 19 / GB-863), whose files are
 *     appended with their raw content and no backing refs, and
 *   - demo mode (GB-947), whose synthetic SVGs (e.g. the giant
 *     `src/assets/icons.min.svg`) are seeded into the DB with no real file on
 *     disk — so once an SVG is shown in the live-rendered `<img>` view (GB-932),
 *     `/api/image/:fileId/:side` would 404.
 *
 * For both, we persist the raw old/new bytes here when the file is created, then
 * read them back to serve the `/image` route. Files live under the review's data
 * dir and are cleared on difftool-session start + teardown; demo runs use a
 * fresh per-run tmpdir, so they need no explicit clear.
 *
 * Keyed by `fileId`+side rather than content hash: the filename is itself the
 * lookup key, which avoids a separate fileId→hash mapping. A re-created file
 * reuses its fileId, so its blobs are overwritten in place.
 */

function blobDir(dataDir: string): string {
  return join(dataDir, 'image-blobs');
}

/** fileIds are base36 (`[a-z0-9]`); strip anything else as belt-and-suspenders
 *  so the key can never escape the blob directory. */
function blobName(fileId: string, side: 'old' | 'new'): string {
  return `${fileId.replace(/[^a-z0-9]/gi, '')}-${side}`;
}

/** Persist one side's raw bytes for a file. No-op for empty content (the absent
 *  side of an add/delete). */
export function writeImageBlob(dataDir: string, fileId: string, side: 'old' | 'new', bytes: Buffer): void {
  if (bytes.length === 0) return;
  const dir = blobDir(dataDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, blobName(fileId, side)), bytes);
}

/** Read back a side's bytes, or null if none were stored. */
export function readImageBlob(dataDir: string, fileId: string, side: 'old' | 'new'): Buffer | null {
  const path = join(blobDir(dataDir), blobName(fileId, side));
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/** Remove every stored blob. Called when a difftool session starts (clear a
 *  previous session's leftovers, e.g. after a hard kill) and when it ends. */
export function clearImageBlobs(dataDir: string): void {
  try {
    rmSync(blobDir(dataDir), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
