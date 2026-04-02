import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { Hono } from 'hono';
import { join, resolve } from 'path';

import {
  addAnnotation, deleteAnnotation, deleteReview,
deleteStaleAnnotations,   getAnnotationsForFile, getAnnotationsForReview,
  getReview, getReviewFile,
getReviewFiles,   getStaleCountsForReview,
keepAllStaleAnnotations,
listReviews,   markAnnotationCurrent, moveAnnotation,
updateAnnotation,   updateFileStatus, updateReviewStatus, } from '../db/queries.js';
import { scheduleAutoExport } from '../export/auto-export.js';
import { addGlassboxToGitignore, deleteReviewExport, dismissGitignorePrompt,generateReviewExport, shouldPromptGitignore } from '../export/generate.js';
import { getFileContent, getFileDiffs, getHeadCommit, parseModeString } from '../git/diff.js';
import { extractMetadata, formatMetadataLines, getContentType, getNewImage, getOldImage, isSvgFile } from '../git/image.js';
import { rasterizeSvg } from '../git/svg-rasterize.js';
import type { OutlineSymbol } from '../outline/parser.js';
import { parseOutline } from '../outline/parser.js';
import { updateReviewDiffs } from '../review-update.js';
import type { AppEnv } from '../types.js';

export const apiRoutes = new Hono<AppEnv>();

// Helper: resolve reviewId from query param or middleware
function resolveReviewId(c: { req: { query: (k: string) => string | undefined }; get: (k: string) => string }): string {
  return c.req.query('reviewId') ?? c.get('reviewId');
}

// --- Reviews ---

apiRoutes.get('/reviews', async (c) => {
  const repoRoot = c.get('repoRoot');
  const reviews = await listReviews(repoRoot);
  return c.json(reviews);
});

apiRoutes.get('/review', async (c) => {
  const reviewId = resolveReviewId(c);
  const review = await getReview(reviewId);
  return c.json(review);
});

apiRoutes.post('/review/complete', async (c) => {
  const reviewId = resolveReviewId(c);
  const currentReviewId = c.get('currentReviewId');
  const repoRoot = c.get('repoRoot');
  await updateReviewStatus(reviewId, 'completed');
  const isCurrent = reviewId === currentReviewId;
  const exportPath = await generateReviewExport(reviewId, repoRoot, isCurrent);
  const gitignorePrompt = shouldPromptGitignore(repoRoot);
  return c.json({ status: 'completed', exportPath, isCurrent, reviewId, gitignorePrompt });
});

apiRoutes.post('/gitignore/add', (c) => {
  const repoRoot = c.get('repoRoot');
  addGlassboxToGitignore(repoRoot);
  return c.json({ ok: true });
});

apiRoutes.post('/gitignore/dismiss', (c) => {
  const repoRoot = c.get('repoRoot');
  dismissGitignorePrompt(repoRoot);
  return c.json({ ok: true });
});

apiRoutes.post('/review/reopen', async (c) => {
  const reviewId = resolveReviewId(c);
  await updateReviewStatus(reviewId, 'in_progress');
  return c.json({ status: 'in_progress' });
});

apiRoutes.post('/review/refresh', async (c) => {
  const reviewId = resolveReviewId(c);
  const repoRoot = c.get('repoRoot');
  const review = await getReview(reviewId);
  if (!review) return c.json({ error: 'Review not found' }, 404);

  const mode = parseModeString(review.mode);
  const headCommit = getHeadCommit(repoRoot);
  const diffs = getFileDiffs(mode, repoRoot);
  const result = await updateReviewDiffs(reviewId, diffs, headCommit);

  return c.json({
    updated: result.updated,
    added: result.added,
    stale: result.stale,
    fileCount: diffs.length,
  });
});

apiRoutes.delete('/review/:id', async (c) => {
  const reviewId = c.req.param('id');
  const currentReviewId = c.get('currentReviewId');
  if (reviewId === currentReviewId) {
    return c.json({ error: 'Cannot delete the current review' }, 400);
  }
  const repoRoot = c.get('repoRoot');
  deleteReviewExport(reviewId, repoRoot);
  await deleteReview(reviewId);
  return c.json({ ok: true });
});

apiRoutes.post('/reviews/delete-completed', async (c) => {
  const currentReviewId = c.get('currentReviewId');
  const repoRoot = c.get('repoRoot');
  const reviews = await listReviews(repoRoot);
  const toDelete = reviews.filter(r => r.status === 'completed' && r.id !== currentReviewId);
  for (const r of toDelete) {
    deleteReviewExport(r.id, repoRoot);
    await deleteReview(r.id);
  }
  return c.json({ deleted: toDelete.length });
});

apiRoutes.post('/reviews/delete-all', async (c) => {
  const currentReviewId = c.get('currentReviewId');
  const repoRoot = c.get('repoRoot');
  const reviews = await listReviews(repoRoot);
  const toDelete = reviews.filter(r => r.id !== currentReviewId);
  for (const r of toDelete) {
    deleteReviewExport(r.id, repoRoot);
    await deleteReview(r.id);
  }
  return c.json({ deleted: toDelete.length });
});

// --- Files ---

apiRoutes.get('/files', async (c) => {
  const reviewId = resolveReviewId(c);
  const files = await getReviewFiles(reviewId);
  const annotationCounts: Record<string, number> = {};
  for (const file of files) {
    const annotations = await getAnnotationsForFile(file.id);
    annotationCounts[file.id] = annotations.length;
  }
  const staleCounts = await getStaleCountsForReview(reviewId);
  return c.json({ files, annotationCounts, staleCounts });
});

apiRoutes.get('/files/:fileId', async (c) => {
  const file = await getReviewFile(c.req.param('fileId'));
  if (!file) return c.json({ error: 'Not found' }, 404);
  const annotations = await getAnnotationsForFile(file.id);
  return c.json({ file, annotations });
});

apiRoutes.patch('/files/:fileId/status', async (c) => {
  const { status } = await c.req.json<{ status: string }>();
  await updateFileStatus(c.req.param('fileId'), status);
  return c.json({ ok: true });
});

apiRoutes.post('/files/:fileId/reveal', async (c) => {
  const file = await getReviewFile(c.req.param('fileId'));
  if (!file) return c.json({ error: 'Not found' }, 404);
  const repoRoot = c.get('repoRoot');
  const fullPath = resolve(repoRoot, file.file_path);
  try {
    if (process.platform === 'darwin') {
      execFileSync('open', ['-R', fullPath]);
    } else if (process.platform === 'win32') {
      execFileSync('explorer', ['/select,' + fullPath]);
    } else {
      // Linux: open the containing directory
      execFileSync('xdg-open', [resolve(fullPath, '..')]);
    }
  } catch { /* ignore errors (e.g. file doesn't exist yet for added files) */ }
  return c.json({ ok: true });
});

// --- Annotations ---

/** Trigger debounced auto-export after any annotation mutation. */
function autoExport(c: { get: (key: 'reviewId' | 'repoRoot') => string }) {
  scheduleAutoExport(c.get('reviewId'), c.get('repoRoot'));
}

apiRoutes.post('/annotations', async (c) => {
  const body = await c.req.json<{
    reviewFileId: string;
    lineNumber: number;
    side: string;
    category: string;
    content: string;
  }>();
  const annotation = await addAnnotation(
    body.reviewFileId, body.lineNumber, body.side, body.category, body.content
  );
  autoExport(c);
  return c.json(annotation, 201);
});

apiRoutes.patch('/annotations/:id', async (c) => {
  const { content, category } = await c.req.json<{ content: string; category: string }>();
  await updateAnnotation(c.req.param('id'), content, category);
  autoExport(c);
  return c.json({ ok: true });
});

apiRoutes.delete('/annotations/:id', async (c) => {
  await deleteAnnotation(c.req.param('id'));
  autoExport(c);
  return c.json({ ok: true });
});

apiRoutes.patch('/annotations/:id/move', async (c) => {
  const { lineNumber, side } = await c.req.json<{ lineNumber: number; side: string }>();
  await moveAnnotation(c.req.param('id'), lineNumber, side);
  autoExport(c);
  return c.json({ ok: true });
});

apiRoutes.post('/annotations/:id/keep', async (c) => {
  await markAnnotationCurrent(c.req.param('id'));
  autoExport(c);
  return c.json({ ok: true });
});

apiRoutes.post('/annotations/stale/delete-all', async (c) => {
  const reviewId = resolveReviewId(c);
  await deleteStaleAnnotations(reviewId);
  autoExport(c);
  return c.json({ ok: true });
});

apiRoutes.post('/annotations/stale/keep-all', async (c) => {
  const reviewId = resolveReviewId(c);
  await keepAllStaleAnnotations(reviewId);
  autoExport(c);
  return c.json({ ok: true });
});

apiRoutes.get('/annotations/all', async (c) => {
  const reviewId = resolveReviewId(c);
  const annotations = await getAnnotationsForReview(reviewId);
  return c.json(annotations);
});

// --- Outline ---

apiRoutes.get('/outline/:fileId', async (c) => {
  const repoRoot = c.get('repoRoot');
  const file = await getReviewFile(c.req.param('fileId'));
  if (!file) return c.json({ error: 'Not found' }, 404);

  const diff = JSON.parse(file.diff_data ?? '{}') as { status?: string };
  const isDeleted = diff.status === 'deleted';

  let content = '';
  try {
    if (isDeleted) {
      content = getFileContent(file.file_path, 'HEAD', repoRoot);
    } else {
      content = getFileContent(file.file_path, 'working', repoRoot);
    }
  } catch {
    // File not accessible
  }

  if (!content) return c.json({ symbols: [] });

  const symbols = parseOutline(content, file.file_path);
  return c.json({ symbols });
});

// --- Symbol Definition Search ---

apiRoutes.get('/symbol-definition', async (c) => {
  const name = c.req.query('name');
  const currentFileId = c.req.query('currentFileId');
  if (name === undefined || name === '') return c.json({ definitions: [] });

  const reviewId = resolveReviewId(c);
  const repoRoot = c.get('repoRoot');

  interface SymbolDef {
    fileId: string | null;
    filePath: string;
    name: string;
    kind: string;
    line: number;
  }

  const definitions: SymbolDef[] = [];
  const searchedPaths = new Set<string>();

  // First pass: search files in the review (they have fileIds for navigation)
  const reviewFiles = await getReviewFiles(reviewId);
  for (const file of reviewFiles) {
    searchedPaths.add(file.file_path);
    const diff = JSON.parse(file.diff_data ?? '{}') as { status?: string };
    const isDeleted = diff.status === 'deleted';
    let content = '';
    try {
      content = isDeleted
        ? getFileContent(file.file_path, 'HEAD', repoRoot)
        : getFileContent(file.file_path, 'working', repoRoot);
    } catch { continue; }
    if (!content) continue;

    const symbols = parseOutline(content, file.file_path);
    collectDefinitions(symbols, name, file.id, file.file_path, definitions);
  }

  // Second pass: if no match found, search all tracked files in the repo
  if (definitions.length === 0) {
    try {
      const allFiles = spawnSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf-8' })
        .stdout.trim().split('\n').filter(Boolean);
      for (const filePath of allFiles) {
        if (searchedPaths.has(filePath)) continue;
        // Only search files the outline parser supports
        const ext = filePath.slice(filePath.lastIndexOf('.'));
        if (!/\.(js|mjs|cjs|jsx|ts|tsx|mts|cts|java|go|rs|c|h|cpp|cc|cxx|hpp|cs|swift|php|kt|kts|scala|dart|groovy|py|rb)$/i.test(ext)) continue;

        let content = '';
        try {
          content = readFileSync(resolve(repoRoot, filePath), 'utf-8');
        } catch { continue; }
        if (!content) continue;

        const symbols = parseOutline(content, filePath);
        collectDefinitions(symbols, name, null, filePath, definitions);
        // Stop after finding first match in repo scan (perf)
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- array mutated by collectDefinitions
        if (definitions.length > 0) break;
      }
    } catch { /* git ls-files failed */ }
  }

  // Sort: same file first, review files before repo files, class before function
  definitions.sort((a, b) => {
    if (a.fileId === currentFileId && b.fileId !== currentFileId) return -1;
    if (b.fileId === currentFileId && a.fileId !== currentFileId) return 1;
    if (a.fileId !== null && b.fileId === null) return -1;
    if (b.fileId !== null && a.fileId === null) return 1;
    if (a.kind === 'class' && b.kind !== 'class') return -1;
    if (b.kind === 'class' && a.kind !== 'class') return 1;
    return 0;
  });

  return c.json({ definitions });
});

function collectDefinitions(
  symbols: OutlineSymbol[],
  targetName: string,
  fileId: string | null,
  filePath: string,
  out: Array<{ fileId: string | null; filePath: string; name: string; kind: string; line: number }>
) {
  for (const sym of symbols) {
    if (sym.name === targetName) {
      out.push({ fileId, filePath, name: sym.name, kind: sym.kind, line: sym.line });
    }
    if (sym.children.length > 0) {
      collectDefinitions(sym.children, targetName, fileId, filePath, out);
    }
  }
}

// --- Context expansion ---

apiRoutes.get('/context/:fileId', async (c) => {
  const repoRoot = c.get('repoRoot');
  const file = await getReviewFile(c.req.param('fileId'));
  if (!file) return c.json({ error: 'Not found' }, 404);

  const startLine = parseInt(c.req.query('start') ?? '1', 10);
  const endLine = parseInt(c.req.query('end') ?? '20', 10);

  const content = getFileContent(file.file_path, 'working', repoRoot);
  const allLines = content.split('\n');
  const clampedStart = Math.max(1, startLine);
  const clampedEnd = Math.min(allLines.length, endLine);
  const lines = [];
  for (let i = clampedStart; i <= clampedEnd; i++) {
    lines.push({ num: i, content: allLines[i - 1] || '' });
  }
  return c.json({ lines });
});

// --- Project Settings ---

interface ProjectSettings {
  appName?: string;
}

function readProjectSettings(repoRoot: string): ProjectSettings {
  const settingsPath = join(repoRoot, '.glassbox', 'settings.json');
  try {
    if (existsSync(settingsPath)) {
      return JSON.parse(readFileSync(settingsPath, 'utf-8')) as ProjectSettings;
    }
  } catch { /* corrupt or missing */ }
  return {};
}

function writeProjectSettings(repoRoot: string, settings: ProjectSettings): void {
  const dir = join(repoRoot, '.glassbox');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8');
}

apiRoutes.get('/project-settings', (c) => {
  const repoRoot = c.get('repoRoot');
  return c.json(readProjectSettings(repoRoot));
});

apiRoutes.patch('/project-settings', async (c) => {
  const repoRoot = c.get('repoRoot');
  const body = await c.req.json<Partial<ProjectSettings>>();
  const current = readProjectSettings(repoRoot);
  if (body.appName !== undefined) current.appName = body.appName || undefined;
  writeProjectSettings(repoRoot, current);
  return c.json(current);
});

// --- Image Diff ---

// Metadata route must come before the :side wildcard route
apiRoutes.get('/image/:fileId/metadata', async (c) => {
  const fileId = c.req.param('fileId');
  const file = await getReviewFile(fileId);
  if (!file) return c.json({ error: 'Not found' }, 404);

  const repoRoot = c.get('repoRoot');
  const review = await getReview(file.review_id);
  if (!review) return c.json({ error: 'Review not found' }, 404);

  const mode = parseModeString(review.mode);
  const diff = JSON.parse(file.diff_data ?? '{}') as { oldPath?: string; status?: string };
  const oldPath: string | null = diff.oldPath ?? null;
  const status = diff.status ?? 'modified';

  const oldImage = status !== 'added' ? getOldImage(mode, file.file_path, oldPath, repoRoot) : null;
  const newImage = status !== 'deleted' ? getNewImage(mode, file.file_path, repoRoot) : null;

  const oldMeta = oldImage !== null ? extractMetadata(oldImage.data, oldPath ?? file.file_path) : null;
  const newMeta = newImage !== null ? extractMetadata(newImage.data, file.file_path) : null;

  return c.json({
    old: oldMeta ? formatMetadataLines(oldMeta) : null,
    new: newMeta ? formatMetadataLines(newMeta) : null,
  });
});

apiRoutes.get('/image/:fileId/:side', async (c) => {
  const fileId = c.req.param('fileId');
  const side = c.req.param('side');
  if (side !== 'old' && side !== 'new') return c.text('Invalid side', 400);

  const file = await getReviewFile(fileId);
  if (!file) return c.text('Not found', 404);

  const repoRoot = c.get('repoRoot');
  const review = await getReview(file.review_id);
  if (!review) return c.text('Review not found', 404);

  const mode = parseModeString(review.mode);
  const diff = JSON.parse(file.diff_data ?? '{}') as { oldPath?: string };
  const oldPath: string | null = diff.oldPath ?? null;

  const image = side === 'old'
    ? getOldImage(mode, file.file_path, oldPath, repoRoot)
    : getNewImage(mode, file.file_path, repoRoot);

  if (!image) return c.text('Image not available', 404);

  // SVGs need rasterization for image comparison modes (difference, slice)
  if (isSvgFile(file.file_path)) {
    try {
      const png = await rasterizeSvg(image.data);
      return new Response(png, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' },
      });
    } catch {
      return c.text('SVG rasterization failed', 500);
    }
  }

  const contentType = getContentType(file.file_path);
  return new Response(image.data, {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
  });
});
