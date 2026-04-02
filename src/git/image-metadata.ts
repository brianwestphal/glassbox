const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function isImageFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function isSvgFile(filePath: string): boolean {
  return filePath.slice(filePath.lastIndexOf('.')).toLowerCase() === '.svg';
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

export function extractMetadata(data: Buffer, filePath: string): ImageMetadata {
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

  // Parse metadata from image headers (no native dependencies)
  const parsed = parseImageHeaders(data, ext);
  return {
    ...parsed,
    fileSize: data.length,
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
  if (meta.colorSpace !== null) lines.push(`Color space: ${meta.colorSpace}`);
  if (meta.channels !== null) lines.push(`Channels: ${meta.channels}`);
  if (meta.depth !== null) lines.push(`Bit depth: ${meta.depth}`);
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

// --- Lightweight image header parsing (no native dependencies) ---

type PartialMeta = Omit<ImageMetadata, 'fileSize'>;

function parseImageHeaders(data: Buffer, ext: string): PartialMeta {
  try {
    if (ext === '.png') return parsePng(data);
    if (ext === '.jpg' || ext === '.jpeg') return parseJpeg(data);
    if (ext === '.gif') return parseGif(data);
    if (ext === '.webp') return parseWebp(data);
  } catch { /* fall through to defaults */ }
  return emptyMeta(ext.slice(1));
}

function emptyMeta(format: string): PartialMeta {
  return { format, width: null, height: null, colorSpace: null, channels: null, depth: null, hasAlpha: null, density: null, exif: null };
}

function parsePng(data: Buffer): PartialMeta {
  // PNG IHDR chunk starts at byte 8, after the 8-byte signature
  // Bytes 16-19: width (big-endian), 20-23: height, 24: bit depth, 25: color type
  if (data.length < 26) return emptyMeta('png');
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const bitDepth = data[24];
  const colorType = data[25];

  let colorSpace: string | null = null;
  let channels: number | null = null;
  let hasAlpha: boolean | null = null;
  switch (colorType) {
    case 0: colorSpace = 'grayscale'; channels = 1; hasAlpha = false; break;
    case 2: colorSpace = 'srgb'; channels = 3; hasAlpha = false; break;
    case 3: colorSpace = 'indexed'; channels = 1; hasAlpha = false; break;
    case 4: colorSpace = 'grayscale'; channels = 2; hasAlpha = true; break;
    case 6: colorSpace = 'srgb'; channels = 4; hasAlpha = true; break;
  }

  // Check for pHYs chunk for DPI
  const density = parsePngDensity(data);

  return { format: 'png', width, height, colorSpace, channels, depth: bitDepth ? String(bitDepth) : null, hasAlpha, density, exif: null };
}

function parsePngDensity(data: Buffer): number | null {
  // Search for pHYs chunk: 4-byte length + "pHYs" + 4-byte X ppu + 4-byte Y ppu + 1-byte unit
  const marker = Buffer.from('pHYs');
  const idx = data.indexOf(marker);
  if (idx === -1 || idx + 13 > data.length) return null;
  const unit = data[idx + 12];
  if (unit !== 1) return null; // 1 = meters
  const ppuX = data.readUInt32BE(idx + 4);
  return Math.round(ppuX / 39.3701); // pixels per meter → DPI
}

function parseJpeg(data: Buffer): PartialMeta {
  // Find SOF0/SOF2 marker (0xFF 0xC0 or 0xFF 0xC2) for dimensions
  let width: number | null = null;
  let height: number | null = null;
  let channels: number | null = null;
  let depth: string | null = null;
  let density: number | null = null;

  let i = 2; // skip SOI marker
  while (i < data.length - 1) {
    if (data[i] !== 0xFF) { i++; continue; }
    const marker = data[i + 1];

    // SOF markers: C0-C3, C5-C7, C9-CB, CD-CF
    if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) ||
        (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
      if (i + 9 < data.length) {
        depth = String(data[i + 4]);
        height = data.readUInt16BE(i + 5);
        width = data.readUInt16BE(i + 7);
        channels = data[i + 9];
      }
      break;
    }

    // JFIF APP0 for density
    if (marker === 0xE0 && i + 14 < data.length) {
      const units = data[i + 11];
      const xDensity = data.readUInt16BE(i + 12);
      if (units === 1) density = xDensity; // pixels per inch
      else if (units === 2) density = Math.round(xDensity * 2.54); // pixels per cm → DPI
    }

    // Skip to next marker
    if (i + 3 < data.length) {
      const len = data.readUInt16BE(i + 2);
      i += 2 + len;
    } else {
      break;
    }
  }

  const colorSpace = channels === 1 ? 'grayscale' : channels === 3 ? 'srgb' : null;
  return { format: 'jpeg', width, height, colorSpace, channels, depth, hasAlpha: false, density, exif: null };
}

function parseGif(data: Buffer): PartialMeta {
  // GIF header: "GIF87a" or "GIF89a" followed by 2-byte width + 2-byte height (little-endian)
  if (data.length < 10) return emptyMeta('gif');
  const width = data.readUInt16LE(6);
  const height = data.readUInt16LE(8);
  return { format: 'gif', width, height, colorSpace: 'indexed', channels: null, depth: null, hasAlpha: null, density: null, exif: null };
}

function parseWebp(data: Buffer): PartialMeta {
  // RIFF header (12 bytes) then chunks
  if (data.length < 30) return emptyMeta('webp');
  let width: number | null = null;
  let height: number | null = null;
  let hasAlpha: boolean | null = null;

  // Check for VP8 (lossy), VP8L (lossless), or VP8X (extended)
  const chunk = data.toString('ascii', 12, 16);
  if (chunk === 'VP8 ' && data.length >= 30) {
    // VP8 lossy: dimensions at bytes 26-29
    width = data.readUInt16LE(26) & 0x3FFF;
    height = data.readUInt16LE(28) & 0x3FFF;
    hasAlpha = false;
  } else if (chunk === 'VP8L' && data.length >= 25) {
    // VP8L lossless: signature byte at 21, then bit-packed width/height
    const bits = data.readUInt32LE(21);
    width = (bits & 0x3FFF) + 1;
    height = ((bits >> 14) & 0x3FFF) + 1;
    hasAlpha = ((bits >> 28) & 1) === 1;
  } else if (chunk === 'VP8X' && data.length >= 30) {
    // VP8X extended: flags at 20, width at 24 (3 bytes LE), height at 27 (3 bytes LE)
    const flags = data[20];
    hasAlpha = (flags & 0x10) !== 0;
    width = (data[24] | (data[25] << 8) | (data[26] << 16)) + 1;
    height = (data[27] | (data[28] << 8) | (data[29] << 16)) + 1;
  }

  return { format: 'webp', width, height, colorSpace: 'srgb', channels: hasAlpha === true ? 4 : 3, depth: null, hasAlpha, density: null, exif: null };
}
