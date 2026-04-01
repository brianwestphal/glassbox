import { isImageFile, isSvgFile, getContentType, extractMetadata, formatMetadataLines } from '../../../src/git/image.js';

describe('isImageFile', () => {
  it('returns true for supported image extensions', () => {
    expect(isImageFile('photo.png')).toBe(true);
    expect(isImageFile('photo.jpg')).toBe(true);
    expect(isImageFile('photo.jpeg')).toBe(true);
    expect(isImageFile('photo.gif')).toBe(true);
    expect(isImageFile('photo.webp')).toBe(true);
    expect(isImageFile('photo.svg')).toBe(true);
  });

  it('returns true regardless of case', () => {
    expect(isImageFile('photo.PNG')).toBe(true);
    expect(isImageFile('photo.JPG')).toBe(true);
    expect(isImageFile('photo.SVG')).toBe(true);
  });

  it('returns false for non-image files', () => {
    expect(isImageFile('script.ts')).toBe(false);
    expect(isImageFile('style.css')).toBe(false);
    expect(isImageFile('README.md')).toBe(false);
    expect(isImageFile('data.json')).toBe(false);
  });

  it('handles paths with directories', () => {
    expect(isImageFile('src/assets/logo.png')).toBe(true);
    expect(isImageFile('deep/path/to/image.jpg')).toBe(true);
  });
});

describe('isSvgFile', () => {
  it('returns true for .svg files', () => {
    expect(isSvgFile('icon.svg')).toBe(true);
    expect(isSvgFile('icon.SVG')).toBe(true);
  });

  it('returns false for non-svg image files', () => {
    expect(isSvgFile('photo.png')).toBe(false);
    expect(isSvgFile('photo.jpg')).toBe(false);
  });
});

describe('getContentType', () => {
  it('returns correct MIME types for images', () => {
    expect(getContentType('img.png')).toBe('image/png');
    expect(getContentType('img.jpg')).toBe('image/jpeg');
    expect(getContentType('img.jpeg')).toBe('image/jpeg');
    expect(getContentType('img.gif')).toBe('image/gif');
    expect(getContentType('img.webp')).toBe('image/webp');
    expect(getContentType('img.svg')).toBe('image/svg+xml');
  });

  it('returns octet-stream for unknown types', () => {
    expect(getContentType('file.bin')).toBe('application/octet-stream');
    expect(getContentType('file.txt')).toBe('application/octet-stream');
  });
});

describe('extractMetadata', () => {
  describe('SVG', () => {
    it('extracts width and height from attributes', async () => {
      const svg = '<svg width="200" height="100"></svg>';
      const meta = await extractMetadata(Buffer.from(svg), 'test.svg');
      expect(meta.format).toBe('svg');
      expect(meta.width).toBe(200);
      expect(meta.height).toBe(100);
      expect(meta.fileSize).toBe(svg.length);
    });

    it('extracts dimensions from viewBox when no width/height', async () => {
      const svg = '<svg viewBox="0 0 300 150"></svg>';
      const meta = await extractMetadata(Buffer.from(svg), 'test.svg');
      expect(meta.width).toBe(300);
      expect(meta.height).toBe(150);
    });

    it('returns null dimensions for SVG without size info', async () => {
      const svg = '<svg></svg>';
      const meta = await extractMetadata(Buffer.from(svg), 'test.svg');
      expect(meta.width).toBeNull();
      expect(meta.height).toBeNull();
    });

    it('returns null for SVG-specific fields', async () => {
      const svg = '<svg width="100" height="100"></svg>';
      const meta = await extractMetadata(Buffer.from(svg), 'test.svg');
      expect(meta.colorSpace).toBeNull();
      expect(meta.channels).toBeNull();
      expect(meta.depth).toBeNull();
      expect(meta.hasAlpha).toBeNull();
      expect(meta.density).toBeNull();
      expect(meta.exif).toBeNull();
    });
  });

  describe('PNG', () => {
    it('extracts dimensions and color info from PNG header', async () => {
      // Minimal valid 1x1 RGBA PNG
      const png = Buffer.from(
        '89504e470d0a1a0a' + // PNG signature
        '0000000d49484452' + // IHDR chunk length + type
        '00000001' + // width: 1
        '00000001' + // height: 1
        '08' + // bit depth: 8
        '06' + // color type: 6 (RGBA)
        '0000000000000000', // rest of IHDR
        'hex'
      );
      const meta = await extractMetadata(png, 'test.png');
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(1);
      expect(meta.height).toBe(1);
      expect(meta.depth).toBe('8');
      expect(meta.colorSpace).toBe('srgb');
      expect(meta.channels).toBe(4);
      expect(meta.hasAlpha).toBe(true);
    });

    it('detects grayscale PNG', async () => {
      const png = Buffer.from(
        '89504e470d0a1a0a' +
        '0000000d49484452' +
        '00000010' +
        '00000010' +
        '08' + // 8-bit
        '00' + // color type 0 = grayscale
        '0000000000000000',
        'hex'
      );
      const meta = await extractMetadata(png, 'test.png');
      expect(meta.colorSpace).toBe('grayscale');
      expect(meta.channels).toBe(1);
      expect(meta.hasAlpha).toBe(false);
    });

    it('returns empty meta for truncated PNG', async () => {
      const meta = await extractMetadata(Buffer.from([0x89, 0x50]), 'test.png');
      expect(meta.format).toBe('png');
      expect(meta.width).toBeNull();
    });
  });

  describe('GIF', () => {
    it('extracts dimensions from GIF header', async () => {
      // GIF89a header with dimensions 100x50
      const gif = Buffer.alloc(10);
      gif.write('GIF89a', 0, 'ascii');
      gif.writeUInt16LE(100, 6); // width
      gif.writeUInt16LE(50, 8);  // height
      const meta = await extractMetadata(gif, 'test.gif');
      expect(meta.format).toBe('gif');
      expect(meta.width).toBe(100);
      expect(meta.height).toBe(50);
      expect(meta.colorSpace).toBe('indexed');
    });
  });
});

describe('formatMetadataLines', () => {
  it('formats basic metadata', () => {
    const lines = formatMetadataLines({
      format: 'png',
      width: 800,
      height: 600,
      fileSize: 1024,
      colorSpace: 'srgb',
      channels: 3,
      depth: '8',
      hasAlpha: false,
      density: 72,
      exif: null,
    });
    expect(lines).toContain('Format: png');
    expect(lines).toContain('Dimensions: 800 × 600');
    expect(lines).toContain('File size: 1.0 KB');
    expect(lines).toContain('Color space: srgb');
    expect(lines).toContain('Channels: 3');
    expect(lines).toContain('Bit depth: 8');
    expect(lines).toContain('Alpha: no');
    expect(lines).toContain('Density: 72 DPI');
  });

  it('omits null fields', () => {
    const lines = formatMetadataLines({
      format: 'svg',
      width: null,
      height: null,
      fileSize: 500,
      colorSpace: null,
      channels: null,
      depth: null,
      hasAlpha: null,
      density: null,
      exif: null,
    });
    expect(lines).toContain('Format: svg');
    expect(lines).toContain('File size: 500 B');
    expect(lines).not.toContainEqual(expect.stringContaining('Dimensions'));
    expect(lines).not.toContainEqual(expect.stringContaining('Color space'));
  });

  it('formats file sizes correctly', () => {
    expect(formatMetadataLines({ format: 'png', width: null, height: null, fileSize: 500, colorSpace: null, channels: null, depth: null, hasAlpha: null, density: null, exif: null })).toContain('File size: 500 B');
    expect(formatMetadataLines({ format: 'png', width: null, height: null, fileSize: 2048, colorSpace: null, channels: null, depth: null, hasAlpha: null, density: null, exif: null })).toContain('File size: 2.0 KB');
    expect(formatMetadataLines({ format: 'png', width: null, height: null, fileSize: 1048576, colorSpace: null, channels: null, depth: null, hasAlpha: null, density: null, exif: null })).toContain('File size: 1.0 MB');
  });

  it('formats EXIF data', () => {
    const lines = formatMetadataLines({
      format: 'jpeg',
      width: 100,
      height: 100,
      fileSize: 5000,
      colorSpace: 'srgb',
      channels: 3,
      depth: '8',
      hasAlpha: false,
      density: 96,
      exif: { Camera: 'iPhone 15', ISO: '100' },
    });
    expect(lines).toContain('EXIF Camera: iPhone 15');
    expect(lines).toContain('EXIF ISO: 100');
  });
});
