import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * On-disk storage for the raw image/SVG bytes of files appended to an
 * accumulating `git difftool` session (doc 19 / GB-863).
 *
 * A difftool review has no git refs and no working tree, so the image-comparison
 * routes (`src/routes/api/image.ts`) can't re-fetch a file's bytes the way they
 * do for every other review mode. We persist the raw old/new content here when
 * the file is appended, then read it back to serve the `/image` route. Files
 * live under the session's data dir and are cleared on session start + teardown.
 *
 * Keyed by `fileId`+side rather than content hash: a difftool session is
 * ephemeral and the filename is itself the lookup key, which avoids a separate
 * fileId→hash mapping. A re-appended file reuses its fileId, so its blobs are
 * overwritten in place — matching the append endpoint's de-dupe-by-path.
 */

function blobDir(dataDir: string): string {
  return join(dataDir, 'difftool-blobs');
}

/** fileIds are base36 (`[a-z0-9]`); strip anything else as belt-and-suspenders
 *  so the key can never escape the blob directory. */
function blobName(fileId: string, side: 'old' | 'new'): string {
  return `${fileId.replace(/[^a-z0-9]/gi, '')}-${side}`;
}

/** Persist one side's raw bytes for an appended difftool file. No-op for empty
 *  content (the absent side of an add/delete). */
export function writeDifftoolBlob(dataDir: string, fileId: string, side: 'old' | 'new', bytes: Buffer): void {
  if (bytes.length === 0) return;
  const dir = blobDir(dataDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, blobName(fileId, side)), bytes);
}

/** Read back a side's bytes, or null if none were stored. */
export function readDifftoolBlob(dataDir: string, fileId: string, side: 'old' | 'new'): Buffer | null {
  const path = join(blobDir(dataDir), blobName(fileId, side));
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

/** Remove every stored blob. Called when a session starts (clear a previous
 *  session's leftovers, e.g. after a hard kill) and when it ends. */
export function clearDifftoolBlobs(dataDir: string): void {
  try {
    rmSync(blobDir(dataDir), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
