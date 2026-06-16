import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { Hono } from 'hono';
import { resolve } from 'path';

import type { SymbolDef } from '../../api/index.js';
import { getReviewFile, getReviewFiles } from '../../db/queries.js';
import { getFileContent, parseDiffData } from '../../git/diff.js';
import type { OutlineSymbol } from '../../outline/parser.js';
import { parseOutline } from '../../outline/parser.js';
import type { AppEnv } from '../../types.js';
import { requirePathParam } from '../../utils/parseBody.js';
import { resolveReviewId } from '../../utils/resolveReviewId.js';

export const outlineRoutes = new Hono<AppEnv>();

outlineRoutes.get('/outline/:fileId', async (c) => {
  const repoRoot = c.get('repoRoot');
  const fileId = requirePathParam(c, 'fileId');
  if (!fileId.ok) return fileId.response;
  const file = await getReviewFile(fileId.data);
  if (!file) return c.json({ error: 'Not found' }, 404);

  const diff = parseDiffData(file.diff_data);
  const isDeleted = diff?.status === 'deleted';

  let content = '';
  try {
    content = isDeleted
      ? getFileContent(file.file_path, 'HEAD', repoRoot)
      : getFileContent(file.file_path, 'working', repoRoot);
  } catch { /* file not accessible */ }

  if (!content) return c.json({ symbols: [] });

  const symbols = parseOutline(content, file.file_path);
  return c.json({ symbols });
});

outlineRoutes.get('/symbol-definition', async (c) => {
  const name = c.req.query('name');
  const currentFileId = c.req.query('currentFileId');
  if (name === undefined || name === '') return c.json({ definitions: [] });

  const reviewId = resolveReviewId(c);
  const repoRoot = c.get('repoRoot');

  const definitions: SymbolDef[] = [];
  const searchedPaths = new Set<string>();

  // First pass: search files in the review (they have fileIds for navigation)
  const reviewFiles = await getReviewFiles(reviewId);
  for (const file of reviewFiles) {
    searchedPaths.add(file.file_path);
    const diff = parseDiffData(file.diff_data);
    const isDeleted = diff?.status === 'deleted';
    let content: string;
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
  out: SymbolDef[],
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
