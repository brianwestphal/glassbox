import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import type { ReviewMode } from './diff.js';

// Re-export metadata utilities so existing importers don't break
export type { ImageMetadata } from './image-metadata.js';
export { extractMetadata, formatMetadataLines,getContentType, isImageFile, isSvgFile } from './image-metadata.js';

/**
 * Get the git ref for the "old" (A) side of a diff, given the review mode.
 * Returns null if the old side is the working directory.
 * Returns ':' for the index (staged files).
 */
function getOldRef(mode: ReviewMode): string | null {
  switch (mode.type) {
    case 'uncommitted': return 'HEAD';
    case 'staged': return 'HEAD';
    case 'unstaged': return null; // old = index, use ':'
    case 'commit': return `${mode.sha}~1`;
    case 'range': return mode.from;
    case 'branch': return mode.name;
    case 'files': return 'HEAD';
    case 'all': return null;
  }
}

/**
 * Get the git ref for the "new" (B) side of a diff, given the review mode.
 * Returns null if the new side is the working directory.
 */
function getNewRef(mode: ReviewMode): string | null {
  switch (mode.type) {
    case 'uncommitted': return null; // working tree
    case 'staged': return null; // index, but git show : works
    case 'unstaged': return null; // working tree
    case 'commit': return mode.sha;
    case 'range': return mode.to;
    case 'branch': return 'HEAD';
    case 'files': return null;
    case 'all': return null;
  }
}

/** Read a file at a specific git ref. Returns null if the file doesn't exist at that ref. */
function gitShowFile(ref: string, filePath: string, repoRoot: string): Buffer | null {
  const spec = ref === ':' ? `:${filePath}` : `${ref}:${filePath}`;
  const result = spawnSync('git', ['show', spec], { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0 || result.stdout.length === 0) return null;
  return result.stdout;
}

/** Read a file from the working directory. Returns null if not found. */
function readWorkingFile(filePath: string, repoRoot: string): Buffer | null {
  try {
    return readFileSync(resolve(repoRoot, filePath));
  } catch {
    return null;
  }
}

export interface ImageSide {
  data: Buffer;
  size: number;
}

/** Get the old (A) version of an image file. */
export function getOldImage(mode: ReviewMode, filePath: string, oldPath: string | null, repoRoot: string): ImageSide | null {
  const ref = getOldRef(mode);
  const path = oldPath ?? filePath;
  if (ref === null) {
    const data = readWorkingFile(path, repoRoot);
    if (!data) return null;
    return { data, size: data.length };
  }
  // For unstaged mode, old = index
  const actualRef = mode.type === 'unstaged' ? ':' : ref;
  const data = gitShowFile(actualRef, path, repoRoot);
  if (!data) return null;
  return { data, size: data.length };
}

/** Get the new (B) version of an image file. */
export function getNewImage(mode: ReviewMode, filePath: string, repoRoot: string): ImageSide | null {
  const ref = getNewRef(mode);
  if (ref === null) {
    // For staged mode, new = index
    if (mode.type === 'staged') {
      const data = gitShowFile(':', filePath, repoRoot);
      if (!data) return null;
      return { data, size: data.length };
    }
    const data = readWorkingFile(filePath, repoRoot);
    if (!data) return null;
    return { data, size: data.length };
  }
  const data = gitShowFile(ref, filePath, repoRoot);
  if (!data) return null;
  return { data, size: data.length };
}
