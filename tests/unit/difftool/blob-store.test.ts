import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearDifftoolBlobs, readDifftoolBlob, writeDifftoolBlob } from '../../../src/difftool/blob-store.js';

// GB-863 — on-disk store for the raw image/SVG bytes of difftool-appended files.
describe('difftool blob store', () => {
  let dataDir: string;
  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'gb-blob-')); });
  afterEach(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('round-trips written bytes by fileId + side', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeDifftoolBlob(dataDir, 'abc123', 'new', png);
    expect(readDifftoolBlob(dataDir, 'abc123', 'new')).toEqual(png);
  });

  it('keeps the old and new sides separate', () => {
    writeDifftoolBlob(dataDir, 'f1', 'old', Buffer.from('OLD'));
    writeDifftoolBlob(dataDir, 'f1', 'new', Buffer.from('NEW'));
    expect(readDifftoolBlob(dataDir, 'f1', 'old')?.toString()).toBe('OLD');
    expect(readDifftoolBlob(dataDir, 'f1', 'new')?.toString()).toBe('NEW');
  });

  it('returns null for a side that was never written', () => {
    expect(readDifftoolBlob(dataDir, 'missing', 'new')).toBeNull();
  });

  it('does not write an empty buffer (the absent side of an add/delete)', () => {
    writeDifftoolBlob(dataDir, 'added', 'old', Buffer.alloc(0));
    expect(readDifftoolBlob(dataDir, 'added', 'old')).toBeNull();
  });

  it('overwrites in place on re-write (a re-append reuses the fileId)', () => {
    writeDifftoolBlob(dataDir, 'f', 'new', Buffer.from('v1'));
    writeDifftoolBlob(dataDir, 'f', 'new', Buffer.from('v2-longer'));
    expect(readDifftoolBlob(dataDir, 'f', 'new')?.toString()).toBe('v2-longer');
  });

  it('clearDifftoolBlobs removes the whole store', () => {
    writeDifftoolBlob(dataDir, 'a', 'new', Buffer.from('x'));
    writeDifftoolBlob(dataDir, 'b', 'old', Buffer.from('y'));
    clearDifftoolBlobs(dataDir);
    expect(readDifftoolBlob(dataDir, 'a', 'new')).toBeNull();
    expect(readDifftoolBlob(dataDir, 'b', 'old')).toBeNull();
    expect(existsSync(join(dataDir, 'difftool-blobs'))).toBe(false);
  });
});
