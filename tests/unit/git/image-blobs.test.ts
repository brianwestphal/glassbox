import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearImageBlobs, readImageBlob, writeImageBlob } from '../../../src/git/image-blobs.js';

// On-disk store for the raw image/SVG bytes of reviews with no git/working-tree
// backing: difftool sessions (GB-863) and demo SVGs (GB-947).
describe('image blob store', () => {
  let dataDir: string;
  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'gb-blob-')); });
  afterEach(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('round-trips written bytes by fileId + side', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeImageBlob(dataDir, 'abc123', 'new', png);
    expect(readImageBlob(dataDir, 'abc123', 'new')).toEqual(png);
  });

  it('keeps the old and new sides separate', () => {
    writeImageBlob(dataDir, 'f1', 'old', Buffer.from('OLD'));
    writeImageBlob(dataDir, 'f1', 'new', Buffer.from('NEW'));
    expect(readImageBlob(dataDir, 'f1', 'old')?.toString()).toBe('OLD');
    expect(readImageBlob(dataDir, 'f1', 'new')?.toString()).toBe('NEW');
  });

  it('returns null for a side that was never written', () => {
    expect(readImageBlob(dataDir, 'missing', 'new')).toBeNull();
  });

  it('does not write an empty buffer (the absent side of an add/delete)', () => {
    writeImageBlob(dataDir, 'added', 'old', Buffer.alloc(0));
    expect(readImageBlob(dataDir, 'added', 'old')).toBeNull();
  });

  it('overwrites in place on re-write (a re-append reuses the fileId)', () => {
    writeImageBlob(dataDir, 'f', 'new', Buffer.from('v1'));
    writeImageBlob(dataDir, 'f', 'new', Buffer.from('v2-longer'));
    expect(readImageBlob(dataDir, 'f', 'new')?.toString()).toBe('v2-longer');
  });

  it('clearImageBlobs removes the whole store', () => {
    writeImageBlob(dataDir, 'a', 'new', Buffer.from('x'));
    writeImageBlob(dataDir, 'b', 'old', Buffer.from('y'));
    clearImageBlobs(dataDir);
    expect(readImageBlob(dataDir, 'a', 'new')).toBeNull();
    expect(readImageBlob(dataDir, 'b', 'old')).toBeNull();
    expect(existsSync(join(dataDir, 'image-blobs'))).toBe(false);
  });
});
