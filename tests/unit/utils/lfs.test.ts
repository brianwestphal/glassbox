/**
 * GB-1102 — Git LFS pointer detection. An LFS-tracked file is stored as a tiny
 * text pointer, so without this an LFS-tracked PNG diffs as text and renders as
 * `oid sha256:…` instead of an image comparison.
 */
import { describe, expect, it } from 'vitest';

import { isLfsPointer } from '../../../src/utils/lfs.js';

const OID = 'a'.repeat(64);
const POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\nsize 232246\n`;

describe('isLfsPointer', () => {
  it('recognizes a pointer as a Buffer and as a string', () => {
    expect(isLfsPointer(POINTER)).toBe(true);
    expect(isLfsPointer(Buffer.from(POINTER, 'utf-8'))).toBe(true);
  });

  it('recognizes a pointer with CRLF line endings', () => {
    expect(isLfsPointer(POINTER.replace(/\n/g, '\r\n'))).toBe(true);
  });

  it('recognizes a pointer with no trailing newline', () => {
    expect(isLfsPointer(POINTER.trimEnd())).toBe(true);
  });

  it('rejects real PNG bytes', () => {
    expect(isLfsPointer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]))).toBe(false);
  });

  it('rejects ordinary text and an empty buffer', () => {
    expect(isLfsPointer('just some source code\n')).toBe(false);
    expect(isLfsPointer(Buffer.alloc(0))).toBe(false);
  });

  it('rejects anything larger than a pointer can be', () => {
    // Prose that opens with the version line but runs long is not a pointer —
    // the size bound is what stops a big file being scanned as one.
    expect(isLfsPointer(POINTER + 'x'.repeat(1100))).toBe(false);
  });

  it('requires all three fields', () => {
    expect(isLfsPointer('version https://git-lfs.github.com/spec/v1\n')).toBe(false);
    expect(isLfsPointer(`version https://git-lfs.github.com/spec/v1\noid sha256:${OID}\n`)).toBe(false);
    expect(isLfsPointer('version https://git-lfs.github.com/spec/v1\nsize 10\n')).toBe(false);
  });

  it('rejects a malformed oid', () => {
    expect(isLfsPointer('version https://git-lfs.github.com/spec/v1\noid sha256:nothex\nsize 10\n')).toBe(false);
    expect(isLfsPointer(`version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(63)}\nsize 10\n`)).toBe(false);
  });

  it('rejects a file that merely mentions the pointer format further down', () => {
    expect(isLfsPointer(`# docs\n${POINTER}`)).toBe(false);
  });
});
