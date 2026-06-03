import { Hono } from 'hono';

import { getDataDir } from '../../db/connection.js';
import { getReview, getReviewFile } from '../../db/queries.js';
import { readDifftoolBlob } from '../../difftool/blob-store.js';
import { parseDiffData, parseModeString } from '../../git/diff.js';
import type { ImageSide } from '../../git/image.js';
import { extractMetadata, formatMetadataLines, getContentType, getNewImage, getOldImage, isSvgFile } from '../../git/image.js';
import { rasterizeSvg } from '../../git/svg-rasterize.js';
import type { AppEnv } from '../../types.js';
import { requirePathParam } from '../../utils/parseBody.js';

export const imageRoutes = new Hono<AppEnv>();

/**
 * A difftool review (doc 19) has no git refs or working tree, so its image bytes
 * come from the blobs persisted at append time (GB-863) rather than
 * `getOldImage`/`getNewImage`. Returns null if nothing was stored for this side.
 */
function difftoolImageSide(fileId: string, side: 'old' | 'new'): ImageSide | null {
  const dataDir = getDataDir();
  if (dataDir === null) return null;
  const bytes = readDifftoolBlob(dataDir, fileId, side);
  return bytes !== null ? { data: bytes, size: bytes.length } : null;
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

  const oldImage = status === 'added' ? null
    : isDifftool ? difftoolImageSide(fileIdParam.data, 'old')
    : getOldImage(mode, file.file_path, oldPath, repoRoot);
  const newImage = status === 'deleted' ? null
    : isDifftool ? difftoolImageSide(fileIdParam.data, 'new')
    : getNewImage(mode, file.file_path, repoRoot);

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

  const image = review.mode === 'difftool'
    ? difftoolImageSide(fileIdParam.data, side)
    : side === 'old'
      ? getOldImage(mode, file.file_path, oldPath, repoRoot)
      : getNewImage(mode, file.file_path, repoRoot);

  if (!image) return c.text('Image not available', 404);

  // GB-836: pick whether to rasterize / what content-type to send based on the
  // side's *own* path. `file.file_path` is always the new-side path, so using
  // it on the old side broke rename-shaped comparisons across image types
  // (e.g. `--diff foo.png foo.svg` rasterized the PNG bytes as if they were
  // SVG and returned 500, leaving the comparison panel empty).
  const sidePath = side === 'old' ? (oldPath ?? file.file_path) : file.file_path;

  // SVGs need rasterization for image comparison modes (difference, slice)
  if (isSvgFile(sidePath)) {
    try {
      const png = await rasterizeSvg(image.data);
      return new Response(new Uint8Array(png), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' },
      });
    } catch {
      return c.text('SVG rasterization failed', 500);
    }
  }

  const contentType = getContentType(sidePath);
  return new Response(new Uint8Array(image.data), {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
  });
});
