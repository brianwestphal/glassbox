import { Hono } from 'hono';

import { getReview, getReviewFile } from '../../db/queries.js';
import { parseDiffData, parseModeString } from '../../git/diff.js';
import { extractMetadata, formatMetadataLines, getContentType, getNewImage, getOldImage, isSvgFile } from '../../git/image.js';
import { rasterizeSvg } from '../../git/svg-rasterize.js';
import type { AppEnv } from '../../types.js';

export const imageRoutes = new Hono<AppEnv>();

// Metadata route must come before the :side wildcard route
imageRoutes.get('/image/:fileId/metadata', async (c) => {
  const fileId = c.req.param('fileId');
  const file = await getReviewFile(fileId);
  if (!file) return c.json({ error: 'Not found' }, 404);

  const repoRoot = c.get('repoRoot');
  const review = await getReview(file.review_id);
  if (!review) return c.json({ error: 'Review not found' }, 404);

  const mode = parseModeString(review.mode);
  const diff = parseDiffData(file.diff_data);
  const oldPath: string | null = diff?.oldPath ?? null;
  const status = diff?.status ?? 'modified';

  const oldImage = status !== 'added' ? getOldImage(mode, file.file_path, oldPath, repoRoot) : null;
  const newImage = status !== 'deleted' ? getNewImage(mode, file.file_path, repoRoot) : null;

  const oldMeta = oldImage !== null ? extractMetadata(oldImage.data, oldPath ?? file.file_path) : null;
  const newMeta = newImage !== null ? extractMetadata(newImage.data, file.file_path) : null;

  return c.json({
    old: oldMeta ? formatMetadataLines(oldMeta) : null,
    new: newMeta ? formatMetadataLines(newMeta) : null,
  });
});

imageRoutes.get('/image/:fileId/:side', async (c) => {
  const fileId = c.req.param('fileId');
  const side = c.req.param('side');
  if (side !== 'old' && side !== 'new') return c.text('Invalid side', 400);

  const file = await getReviewFile(fileId);
  if (!file) return c.text('Not found', 404);

  const repoRoot = c.get('repoRoot');
  const review = await getReview(file.review_id);
  if (!review) return c.text('Review not found', 404);

  const mode = parseModeString(review.mode);
  const diff = parseDiffData(file.diff_data);
  const oldPath: string | null = diff?.oldPath ?? null;

  const image = side === 'old'
    ? getOldImage(mode, file.file_path, oldPath, repoRoot)
    : getNewImage(mode, file.file_path, repoRoot);

  if (!image) return c.text('Image not available', 404);

  // SVGs need rasterization for image comparison modes (difference, slice)
  if (isSvgFile(file.file_path)) {
    try {
      const png = await rasterizeSvg(image.data);
      return new Response(new Uint8Array(png), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' },
      });
    } catch {
      return c.text('SVG rasterization failed', 500);
    }
  }

  const contentType = getContentType(file.file_path);
  return new Response(new Uint8Array(image.data), {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
  });
});
