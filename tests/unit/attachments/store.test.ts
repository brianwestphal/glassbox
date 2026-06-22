import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setDataDir } from '../../../src/db/connection.js';
import {
  attachmentsDir,
  deleteAttachmentFile,
  sanitizeFilename,
  writeAttachmentFile,
} from '../../../src/attachments/store.js';

// doc 25 — on-disk attachment storage helpers.
describe('attachment store', () => {
  let dataDir: string;
  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'glassbox-att-store-'));
    setDataDir(dataDir);
  });
  afterAll(() => { rmSync(dataDir, { recursive: true, force: true }); });

  describe('sanitizeFilename', () => {
    it('strips path separators so a name cannot escape the dir', () => {
      expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
      expect(sanitizeFilename('a/b/c.png')).toBe('c.png');
      expect(sanitizeFilename('a\\b\\c.png')).toBe('c.png');
    });
    it('drops control + reserved characters', () => {
      expect(sanitizeFilename('na<me>:"|?.txt')).toBe('name.txt');
    });
    it('falls back when the whole name sanitizes away', () => {
      expect(sanitizeFilename('/// ')).toBe('attachment');
    });
  });

  describe('write / read / delete', () => {
    it('round-trips bytes and records size + sha', () => {
      const bytes = Buffer.from('attachment body');
      const { storedPath, size, sha256 } = writeAttachmentFile('id123', 'report.txt', bytes);
      expect(storedPath).toBe(join(attachmentsDir() as string, 'id123-report.txt'));
      expect(size).toBe(bytes.length);
      expect(sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(readFileSync(storedPath).toString()).toBe('attachment body');

      deleteAttachmentFile(storedPath);
      expect(existsSync(storedPath)).toBe(false);
    });

    it('names the file by id + sanitized original (no traversal)', () => {
      const { storedPath } = writeAttachmentFile('id9', '../evil.sh', Buffer.from('x'));
      expect(storedPath).toBe(join(attachmentsDir() as string, 'id9-evil.sh'));
      deleteAttachmentFile(storedPath);
    });

    it('deleteAttachmentFile is a no-op on a missing file', () => {
      expect(() => deleteAttachmentFile(join(dataDir, 'attachments', 'nope'))).not.toThrow();
    });
  });
});
