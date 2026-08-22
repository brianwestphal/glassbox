/**
 * Path-traversal defense helpers (doc 14, FR-14.3; GB-1156). These pin the exact
 * behavior the previously-inlined copies had, so the shared extraction can't
 * change it.
 */
import { describe, expect, it } from 'vitest';

import { escapesRepo, sanitizeRelPath } from '../../../src/utils/relPath.js';

describe('sanitizeRelPath', () => {
  it('passes a normal relative path through unchanged', () => {
    expect(sanitizeRelPath('src/a/b.ts')).toBe('src/a/b.ts');
  });

  it('forward-slashes backslashes', () => {
    expect(sanitizeRelPath('src\\a\\b.ts')).toBe('src/a/b.ts');
  });

  it('strips leading slashes (absolute → relative)', () => {
    expect(sanitizeRelPath('/etc/passwd')).toBe('etc/passwd');
    expect(sanitizeRelPath('///x')).toBe('x');
  });

  it('neutralizes parent-escaping `..` segments to `_`', () => {
    expect(sanitizeRelPath('../secret')).toBe('_/secret');
    expect(sanitizeRelPath('a/../../b')).toBe('a/_/_/b');
    expect(sanitizeRelPath('a/..')).toBe('a/_');
  });

  it('does NOT touch a `..` embedded in a filename (only whole segments)', () => {
    expect(sanitizeRelPath('a/..b/c')).toBe('a/..b/c');
    expect(sanitizeRelPath('file..ext')).toBe('file..ext');
  });

  it('returns "file" for an empty result', () => {
    expect(sanitizeRelPath('')).toBe('file');
    expect(sanitizeRelPath('/')).toBe('file');
  });
});

describe('escapesRepo', () => {
  it('is false for a normal relative path', () => {
    expect(escapesRepo('src/a/b.ts')).toBe(false);
    expect(escapesRepo('a/..b/c')).toBe(false); // `..` inside a name is not a segment
  });

  it('is true when a `..` segment is present (any position)', () => {
    expect(escapesRepo('../x')).toBe(true);
    expect(escapesRepo('a/../b')).toBe(true);
    expect(escapesRepo('a/..')).toBe(true);
    expect(escapesRepo('..')).toBe(true);
  });

  it('normalizes backslashes before checking', () => {
    expect(escapesRepo('a\\..\\b')).toBe(true);
  });
});
