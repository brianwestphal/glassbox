import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { join,resolve } from 'path';

import { isLfsPointer } from '../utils/lfs.js';
import type { ReviewMode } from './diff.js';
import { directComparisonRoots } from './diff.js';
import { scrubbedGitEnv } from './repo.js';

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
    case 'diff': return null; // direct comparison reads from disk, not a ref
    case 'ground-truth': return null; // reads expected/actual from disk, not a ref
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
    case 'diff': return null; // direct comparison reads from disk, not a ref
    case 'ground-truth': return null; // reads expected/actual from disk, not a ref
  }
}

/** Read a file at a specific git ref. Returns null if the file doesn't exist at that ref. */
function gitShowFile(ref: string, filePath: string, repoRoot: string): Buffer | null {
  const spec = ref === ':' ? `:${filePath}` : `${ref}:${filePath}`;
  const result = spawnSync('git', ['show', spec], { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024, env: scrubbedGitEnv() });
  if (result.status !== 0 || result.stdout.length === 0) return null;
  // `git show` reads the object database, which for an LFS-tracked file holds
  // the pointer, not the image. `git cat-file --filters` runs the same content
  // through git's smudge filters, which is what materializes the real bytes.
  // Only reached for an actual pointer, so a normal file keeps the cheaper path
  // and is never put through a filter that might rewrite it.
  if (isLfsPointer(result.stdout)) {
    const smudged = spawnSync('git', ['cat-file', '--filters', spec], { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024, env: scrubbedGitEnv() });
    // Fail soft: without the LFS object available (a partial clone, or LFS not
    // installed) the smudge is a no-op that hands back the pointer again. Better
    // a missing image than a corrupt one.
    if (smudged.status === 0 && smudged.stdout.length > 0 && !isLfsPointer(smudged.stdout)) {
      return smudged.stdout;
    }
    return null;
  }
  return result.stdout;
}

/** Read a file from the working directory. Returns null if not found. */
function readWorkingFile(filePath: string, repoRoot: string): Buffer | null {
  try {
    const data = readFileSync(resolve(repoRoot, filePath));
    // A working-tree file is a pointer when the repo was cloned without LFS (or
    // with smudging skipped). The real bytes simply aren't on this machine, so
    // there is nothing to recover — return nothing rather than hand pointer
    // text to an <img>, which renders as a corrupt image with no explanation.
    return isLfsPointer(data) ? null : data;
  } catch {
    return null;
  }
}

export interface ImageSide {
  data: Buffer;
  size: number;
}

/** Read an image side from an absolute path on disk (direct-comparison mode). */
function readDiskImage(absPath: string): ImageSide | null {
  try {
    const data = readFileSync(absPath);
    return { data, size: data.length };
  } catch {
    return null;
  }
}

/** Find a ground-truth comparison by its lookup key (the review file's path). */
function groundTruthEntry(mode: ReviewMode, filePath: string) {
  return mode.type === 'ground-truth'
    ? mode.comparisons.find(e => e.key === filePath) ?? null
    : null;
}

/** Get the old (A) version of an image file. */
export function getOldImage(mode: ReviewMode, filePath: string, oldPath: string | null, repoRoot: string): ImageSide | null {
  if (mode.type === 'diff') {
    return readDiskImage(join(directComparisonRoots(mode).rootA, oldPath ?? filePath));
  }
  if (mode.type === 'ground-truth') {
    // The expected / ground-truth image is the old (A) side (doc 26).
    const entry = groundTruthEntry(mode, filePath);
    return entry !== null ? readDiskImage(entry.expectedPath) : null;
  }
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
  if (mode.type === 'diff') {
    return readDiskImage(join(directComparisonRoots(mode).rootB, filePath));
  }
  if (mode.type === 'ground-truth') {
    // The actual image is the new (B) side (doc 26).
    const entry = groundTruthEntry(mode, filePath);
    return entry !== null ? readDiskImage(entry.actualPath) : null;
  }
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
