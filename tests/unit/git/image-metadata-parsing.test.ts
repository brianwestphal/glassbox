/**
 * Unit tests for the byte-level header parsers in src/git/image-metadata.ts.
 * image.test.ts already covers SVG / PNG-basics / GIF; this file closes the
 * uncovered JPEG, WebP, PNG-density, and graceful-malformed-input branches by
 * feeding crafted minimal buffers. These parsers are pure (no fs/spawn), so no
 * mocks are needed.
 */
import { describe, expect, it } from 'vitest';

import {
  extractMetadata,
  formatMetadataLines,
  getContentType,
  isImageFile,
  isSvgFile,
} from '../../../src/git/image-metadata.js';

describe('isImageFile / isSvgFile / getContentType', () => {
  it('recognizes known image extensions case-insensitively', () => {
    expect(isImageFile('a/b/photo.PNG')).toBe(true);
    expect(isImageFile('icon.svg')).toBe(true);
    expect(isImageFile('clip.webp')).toBe(true);
    expect(isImageFile('notes.txt')).toBe(false);
  });

  it('flags only .svg as svg', () => {
    expect(isSvgFile('logo.SVG')).toBe(true);
    expect(isSvgFile('logo.png')).toBe(false);
  });

  it('maps extensions to MIME types and falls back to octet-stream', () => {
    expect(getContentType('x.png')).toBe('image/png');
    expect(getContentType('x.JPG')).toBe('image/jpeg');
    expect(getContentType('x.jpeg')).toBe('image/jpeg');
    expect(getContentType('x.gif')).toBe('image/gif');
    expect(getContentType('x.webp')).toBe('image/webp');
    expect(getContentType('x.svg')).toBe('image/svg+xml');
    expect(getContentType('x.bin')).toBe('application/octet-stream');
  });
});

describe('JPEG parsing', () => {
  /** Build a minimal JPEG: SOI, optional APP0/JFIF, then an SOF0 frame. */
  function buildJpeg(opts: { width: number; height: number; channels: number; depth: number; jfifUnits?: number; jfifXDensity?: number }): Buffer {
    const parts: Buffer[] = [];
    parts.push(Buffer.from([0xff, 0xd8])); // SOI

    if (opts.jfifUnits !== undefined) {
      // APP0 / JFIF segment. Marker 0xFFE0, then 2-byte length, then payload.
      // The parser reads units at i+11 and xDensity at i+12 (i points at 0xFF).
      const app0 = Buffer.alloc(18);
      app0[0] = 0xff; app0[1] = 0xe0;
      app0.writeUInt16BE(16, 2); // segment length
      app0.write('JFIF\0', 4, 'ascii');
      app0[9] = 1; app0[10] = 2; // version
      app0[11] = opts.jfifUnits;
      app0.writeUInt16BE(opts.jfifXDensity ?? 0, 12);
      parts.push(app0);
    }

    // SOF0 (0xFFC0): length(2) precision(1) height(2) width(2) components(1)...
    // The parser, with i at the 0xFF, reads: depth=i+4, height=i+5, width=i+7, channels=i+9.
    const sof = Buffer.alloc(11);
    sof[0] = 0xff; sof[1] = 0xc0;
    sof.writeUInt16BE(8, 2); // segment length
    sof[4] = opts.depth;
    sof.writeUInt16BE(opts.height, 5);
    sof.writeUInt16BE(opts.width, 7);
    sof[9] = opts.channels;
    parts.push(sof);

    return Buffer.concat(parts);
  }

  it('extracts dimensions, depth and channels from an SOF0 frame', () => {
    const jpeg = buildJpeg({ width: 640, height: 480, channels: 3, depth: 8 });
    const meta = extractMetadata(jpeg, 'photo.jpg');
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(480);
    expect(meta.depth).toBe('8');
    expect(meta.channels).toBe(3);
    expect(meta.colorSpace).toBe('srgb');
    expect(meta.hasAlpha).toBe(false);
  });

  it('reports grayscale for a single-channel JPEG', () => {
    const jpeg = buildJpeg({ width: 10, height: 20, channels: 1, depth: 8 });
    const meta = extractMetadata(jpeg, 'gray.jpeg');
    expect(meta.channels).toBe(1);
    expect(meta.colorSpace).toBe('grayscale');
  });

  it('reads density from a JFIF APP0 segment (units=1, dpi)', () => {
    const jpeg = buildJpeg({ width: 100, height: 100, channels: 3, depth: 8, jfifUnits: 1, jfifXDensity: 72 });
    const meta = extractMetadata(jpeg, 'photo.jpg');
    expect(meta.density).toBe(72);
  });

  it('converts JFIF density in pixels-per-cm (units=2) to DPI', () => {
    const jpeg = buildJpeg({ width: 100, height: 100, channels: 3, depth: 8, jfifUnits: 2, jfifXDensity: 100 });
    const meta = extractMetadata(jpeg, 'photo.jpg');
    // 100 px/cm * 2.54 ≈ 254 DPI
    expect(meta.density).toBe(254);
  });

  it('returns null dimensions for a JPEG with no frame marker', () => {
    // SOI only — the scan finds no SOF and never sets width/height.
    const meta = extractMetadata(Buffer.from([0xff, 0xd8, 0x00, 0x00]), 'broken.jpg');
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBeNull();
    expect(meta.height).toBeNull();
  });
});

describe('PNG density (pHYs chunk)', () => {
  function buildPngWithPhys(ppuX: number, unit: number): Buffer {
    // Signature + IHDR (1x1, 8-bit, RGB) then a pHYs chunk somewhere after.
    const head = Buffer.from(
      '89504e470d0a1a0a' +
      '0000000d49484452' +
      '00000001' + '00000001' +
      '08' + '02' +
      '0000000000000000',
      'hex',
    );
    const phys = Buffer.alloc(17);
    phys.writeUInt32BE(9, 0); // chunk data length
    phys.write('pHYs', 4, 'ascii');
    phys.writeUInt32BE(ppuX, 8); // X pixels per unit
    phys.writeUInt32BE(ppuX, 12); // Y pixels per unit
    phys[16] = unit; // unit specifier
    return Buffer.concat([head, phys]);
  }

  it('computes DPI from a pHYs chunk in pixels-per-meter (unit=1)', () => {
    const png = buildPngWithPhys(3779, 1); // 3779 ppm ≈ 96 DPI
    const meta = extractMetadata(png, 'dpi.png');
    expect(meta.density).toBe(96);
  });

  it('ignores a pHYs chunk whose unit is not meters', () => {
    const png = buildPngWithPhys(3779, 0);
    const meta = extractMetadata(png, 'dpi.png');
    expect(meta.density).toBeNull();
  });
});

describe('WebP parsing', () => {
  function buildRiffHeader(): Buffer {
    const b = Buffer.alloc(12);
    b.write('RIFF', 0, 'ascii');
    b.writeUInt32LE(0, 4); // file size (ignored by parser)
    b.write('WEBP', 8, 'ascii');
    return b;
  }

  it('parses a lossy VP8 frame (dimensions at bytes 26-29)', () => {
    const buf = Buffer.alloc(30);
    buildRiffHeader().copy(buf, 0);
    buf.write('VP8 ', 12, 'ascii');
    buf.writeUInt16LE(200, 26);
    buf.writeUInt16LE(100, 28);
    const meta = extractMetadata(buf, 'img.webp');
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);
    expect(meta.hasAlpha).toBe(false);
    expect(meta.channels).toBe(3);
  });

  it('parses a lossless VP8L frame (bit-packed width/height + alpha bit)', () => {
    // parseWebp early-returns for buffers under 30 bytes, so pad past that.
    const buf = Buffer.alloc(30);
    buildRiffHeader().copy(buf, 0);
    buf.write('VP8L', 12, 'ascii');
    // width-1 = 99 (so width 100), height-1 = 49 (so height 50), alpha bit set (bit 28).
    const widthMinus1 = 99;
    const heightMinus1 = 49;
    const bits = (widthMinus1 & 0x3fff) | ((heightMinus1 & 0x3fff) << 14) | (1 << 28);
    buf.writeUInt32LE(bits >>> 0, 21);
    const meta = extractMetadata(buf, 'img.webp');
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(50);
    expect(meta.hasAlpha).toBe(true);
    expect(meta.channels).toBe(4);
  });

  it('parses an extended VP8X frame (24-bit dimensions + alpha flag)', () => {
    const buf = Buffer.alloc(30);
    buildRiffHeader().copy(buf, 0);
    buf.write('VP8X', 12, 'ascii');
    buf[20] = 0x10; // alpha flag set
    // width-1 = 511 → width 512; height-1 = 255 → height 256.
    const w = 511; const h = 255;
    buf[24] = w & 0xff; buf[25] = (w >> 8) & 0xff; buf[26] = (w >> 16) & 0xff;
    buf[27] = h & 0xff; buf[28] = (h >> 8) & 0xff; buf[29] = (h >> 16) & 0xff;
    const meta = extractMetadata(buf, 'img.webp');
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(256);
    expect(meta.hasAlpha).toBe(true);
  });

  it('returns empty webp meta for a too-short buffer', () => {
    const meta = extractMetadata(Buffer.alloc(10), 'tiny.webp');
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeNull();
    expect(meta.height).toBeNull();
  });
});

describe('graceful handling of unknown/truncated input', () => {
  it('returns empty meta for a truncated GIF', () => {
    const meta = extractMetadata(Buffer.from([0x47, 0x49, 0x46]), 'x.gif');
    expect(meta.format).toBe('gif');
    expect(meta.width).toBeNull();
  });

  it('uses the bare extension as format for an unrecognized image type', () => {
    const meta = extractMetadata(Buffer.from([0x00, 0x01, 0x02]), 'mystery.bmp');
    expect(meta.format).toBe('bmp');
    expect(meta.width).toBeNull();
    expect(meta.fileSize).toBe(3);
  });

  it('falls back to defaults for malformed SVG without dimensions', () => {
    const meta = extractMetadata(Buffer.from('<svg width="abc"></svg>'), 'bad.svg');
    // parseFloat('abc') is NaN → coerced to null.
    expect(meta.width).toBeNull();
  });
});

describe('formatMetadataLines edge cases', () => {
  it('omits Dimensions when only one of width/height is present', () => {
    const lines = formatMetadataLines({
      format: 'png', width: 100, height: null, fileSize: 10,
      colorSpace: null, channels: null, depth: null, hasAlpha: null, density: null, exif: null,
    });
    expect(lines).not.toContainEqual(expect.stringContaining('Dimensions'));
  });

  it('renders Alpha: yes when hasAlpha is true', () => {
    const lines = formatMetadataLines({
      format: 'png', width: 1, height: 1, fileSize: 10,
      colorSpace: null, channels: null, depth: null, hasAlpha: true, density: null, exif: null,
    });
    expect(lines).toContain('Alpha: yes');
  });
});
