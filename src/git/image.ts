import { execSync } from 'child_process';
import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import type { ReviewMode } from './diff.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function isImageFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function getContentType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

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
  try {
    const spec = ref === ':' ? `:${filePath}` : `${ref}:${filePath}`;
    return execSync(`git show "${spec}"`, { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 });
  } catch {
    return null;
  }
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

export interface ImageMetadata {
  format: string;
  width: number | null;
  height: number | null;
  fileSize: number;
  colorSpace: string | null;
  channels: number | null;
  depth: string | null;
  hasAlpha: boolean | null;
  density: number | null;
  exif: Record<string, string> | null;
}

export async function extractMetadata(data: Buffer, filePath: string): Promise<ImageMetadata> {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();

  // SVG: parse text, not sharp
  if (ext === '.svg') {
    const text = data.toString('utf-8');
    const widthMatch = text.match(/\bwidth\s*=\s*["']([^"']+)["']/);
    const heightMatch = text.match(/\bheight\s*=\s*["']([^"']+)["']/);
    const viewBoxMatch = text.match(/\bviewBox\s*=\s*["']([^"']+)["']/);
    let width: number | null = widthMatch ? parseFloat(widthMatch[1]) : null;
    let height: number | null = heightMatch ? parseFloat(heightMatch[1]) : null;
    if (width === null && height === null && viewBoxMatch) {
      const parts = viewBoxMatch[1].split(/[\s,]+/);
      if (parts.length >= 4) {
        width = parseFloat(parts[2]);
        height = parseFloat(parts[3]);
      }
    }
    return {
      format: 'svg',
      width: width !== null && !isNaN(width) ? width : null,
      height: height !== null && !isNaN(height) ? height : null,
      fileSize: data.length,
      colorSpace: null,
      channels: null,
      depth: null,
      hasAlpha: null,
      density: null,
      exif: null,
    };
  }

  const sharp = (await import('sharp')).default;
  const meta = await sharp(data).metadata();
  let exif: Record<string, string> | null = null;
  if (meta.exif) {
    try {
      // Parse EXIF buffer into readable key-value pairs
      // sharp exposes raw exif buffer; we extract basic info
      exif = {};
      if (meta.orientation) exif['Orientation'] = String(meta.orientation);
    } catch { /* ignore parse errors */ }
  }

  return {
    format: meta.format ?? ext.slice(1),
    width: meta.width ?? null,
    height: meta.height ?? null,
    fileSize: data.length,
    colorSpace: meta.space ?? null,
    channels: meta.channels ?? null,
    depth: meta.depth ?? null,
    hasAlpha: meta.hasAlpha ?? null,
    density: meta.density ?? null,
    exif,
  };
}

/** Format metadata into diffable text lines. */
export function formatMetadataLines(meta: ImageMetadata): string[] {
  const lines: string[] = [];
  lines.push(`Format: ${meta.format}`);
  if (meta.width !== null && meta.height !== null) {
    lines.push(`Dimensions: ${meta.width} × ${meta.height}`);
  }
  lines.push(`File size: ${formatBytes(meta.fileSize)}`);
  if (meta.colorSpace) lines.push(`Color space: ${meta.colorSpace}`);
  if (meta.channels !== null) lines.push(`Channels: ${meta.channels}`);
  if (meta.depth) lines.push(`Bit depth: ${meta.depth}`);
  if (meta.hasAlpha !== null) lines.push(`Alpha: ${meta.hasAlpha ? 'yes' : 'no'}`);
  if (meta.density !== null) lines.push(`Density: ${meta.density} DPI`);
  if (meta.exif) {
    for (const [key, value] of Object.entries(meta.exif)) {
      lines.push(`EXIF ${key}: ${value}`);
    }
  }
  return lines;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
