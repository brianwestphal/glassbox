import { Hono } from 'hono';

import { getDataDir } from '../../db/connection.js';
import { getReview, getReviewFile } from '../../db/queries.js';
import type { ReviewMode } from '../../git/diff.js';
import { parseDiffData, parseModeString } from '../../git/diff.js';
import type { ImageSide } from '../../git/image.js';
import { extractMetadata, formatMetadataLines, getContentType, getNewImage, getOldImage } from '../../git/image.js';
import { readImageBlob } from '../../git/image-blobs.js';
import type { AppEnv } from '../../types.js';
import { requirePathParam } from '../../utils/parseBody.js';

export const imageRoutes = new Hono<AppEnv>();

/**
 * Read a side's bytes from the on-disk blob store (`src/git/image-blobs.ts`).
 * Returns null if nothing was stored for this side / there's no data dir.
 */
function blobImageSide(fileId: string, side: 'old' | 'new'): ImageSide | null {
  const dataDir = getDataDir();
  if (dataDir === null) return null;
  const bytes = readImageBlob(dataDir, fileId, side);
  return bytes !== null ? { data: bytes, size: bytes.length } : null;
}

/**
 * Resolve one side's image bytes for any review mode, honoring add/delete (the
 * absent side has no bytes).
 *
 * - A difftool review (doc 19) has no git refs or working tree, so its bytes
 *   come only from the blobs persisted at append time (GB-863).
 * - Every other mode reads from git / the working tree, but falls back to the
 *   blob store when that yields nothing — demo mode (GB-947) seeds synthetic
 *   SVGs that exist nowhere on disk, so the live-rendered `<img>` view (GB-932)
 *   would otherwise 404.
 */
function resolveImageSide(
  fileId: string,
  side: 'old' | 'new',
  status: string,
  mode: ReviewMode,
  filePath: string,
  oldPath: string | null,
  repoRoot: string,
  isDifftool: boolean,
): ImageSide | null {
  if (side === 'old' && status === 'added') return null;
  if (side === 'new' && status === 'deleted') return null;
  if (isDifftool) return blobImageSide(fileId, side);
  const fromGit = side === 'old'
    ? getOldImage(mode, filePath, oldPath, repoRoot)
    : getNewImage(mode, filePath, repoRoot);
  return fromGit ?? blobImageSide(fileId, side);
}

// Metadata route must come before the :side wildcard route
imageRoutes.get('/image/:fileId/metadata', async (c) => {
  const fileIdParam = requirePathParam(c, 'fileId');
  if (!fileIdParam.ok) return fileIdParam.response;
  const file = await getReviewFile(fileIdParam.data);
  if (!file) return c.json({ error: 'Not found' }, 404);

  const repoRoot = c.get('repoRoot');
  const review = await getReview(file.review_id);
  if (!review) return c.json({ error: 'Review not found' }, 404);

  const mode = parseModeString(review.mode);
  const diff = parseDiffData(file.diff_data);
  const oldPath: string | null = diff?.oldPath ?? null;
  const status = diff?.status ?? 'modified';
  const isDifftool = review.mode === 'difftool';

  const oldImage = resolveImageSide(fileIdParam.data, 'old', status, mode, file.file_path, oldPath, repoRoot, isDifftool);
  const newImage = resolveImageSide(fileIdParam.data, 'new', status, mode, file.file_path, oldPath, repoRoot, isDifftool);

  const oldMeta = oldImage !== null ? extractMetadata(oldImage.data, oldPath ?? file.file_path) : null;
  const newMeta = newImage !== null ? extractMetadata(newImage.data, file.file_path) : null;

  return c.json({
    old: oldMeta ? formatMetadataLines(oldMeta) : null,
    new: newMeta ? formatMetadataLines(newMeta) : null,
  });
});

imageRoutes.get('/image/:fileId/:side', async (c) => {
  const fileIdParam = requirePathParam(c, 'fileId');
  if (!fileIdParam.ok) return fileIdParam.response;
  const side = c.req.param('side');
  if (side !== 'old' && side !== 'new') return c.text('Invalid side', 400);

  const file = await getReviewFile(fileIdParam.data);
  if (!file) return c.text('Not found', 404);

  const repoRoot = c.get('repoRoot');
  const review = await getReview(file.review_id);
  if (!review) return c.text('Review not found', 404);

  const mode = parseModeString(review.mode);
  const diff = parseDiffData(file.diff_data);
  const oldPath: string | null = diff?.oldPath ?? null;
  const status = diff?.status ?? 'modified';

  const image = resolveImageSide(
    fileIdParam.data, side, status, mode, file.file_path, oldPath, repoRoot,
    review.mode === 'difftool',
  );

  if (!image) return c.text('Image not available', 404);

  // GB-836: pick the content-type from the side's *own* path. `file.file_path`
  // is always the new-side path, so using it on the old side broke rename-shaped
  // comparisons across image types (e.g. `--diff foo.png foo.svg` mislabeled the
  // PNG bytes, leaving the comparison panel empty).
  //
  // GB-932: SVGs are served as raw `image/svg+xml` and rendered live by the
  // browser, so animated SVGs animate and text renders with the browser's own
  // font stack. `<img>` does not execute scripts or load external resources, so
  // serving the bytes directly is safe. The comparison modes (difference via
  // `mix-blend-mode`, slice via `clip-path`, zoom/pan) all work on a native-SVG
  // `<img>` exactly as they do for raster images.
  const sidePath = side === 'old' ? (oldPath ?? file.file_path) : file.file_path;
  const contentType = getContentType(sidePath);
  return new Response(new Uint8Array(image.data), {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
  });
});
