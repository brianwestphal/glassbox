import { charDiff } from '../../../src/utils/charDiff.js';

describe('charDiff', () => {
  it('returns null for identical strings', () => {
    expect(charDiff('hello', 'hello')).toBeNull();
  });

  it('returns null for both empty strings', () => {
    expect(charDiff('', '')).toBeNull();
  });

  it('returns null for completely different strings (below 20% similarity)', () => {
    expect(charDiff('abcde', 'fghij')).toBeNull();
  });

  it('identifies changed characters in similar strings', () => {
    const result = charDiff('hello world', 'hello earth');
    expect(result).not.toBeNull();
    // Old should have "world" marked as changed, "hello " as unchanged
    const oldUnchanged = result!.oldSegments.filter(s => !s.changed).map(s => s.text).join('');
    expect(oldUnchanged).toContain('hello');
    // New should have "earth" with some characters marked as changed
    const newUnchanged = result!.newSegments.filter(s => !s.changed).map(s => s.text).join('');
    expect(newUnchanged).toContain('hello');
  });

  it('handles single character change', () => {
    const result = charDiff('cat', 'cut');
    expect(result).not.toBeNull();
    // 'c' and 't' are common, 'a' vs 'u' are different
    expect(result!.oldSegments.length).toBeGreaterThanOrEqual(2);
    expect(result!.newSegments.length).toBeGreaterThanOrEqual(2);
  });

  it('returns segments that reconstruct the original strings', () => {
    const result = charDiff('function foo()', 'function bar()');
    expect(result).not.toBeNull();
    const oldText = result!.oldSegments.map(s => s.text).join('');
    const newText = result!.newSegments.map(s => s.text).join('');
    expect(oldText).toBe('function foo()');
    expect(newText).toBe('function bar()');
  });

  it('handles addition (old shorter than new)', () => {
    const result = charDiff('abc', 'aXbYcZ');
    expect(result).not.toBeNull();
    // All of abc should be in common
    const oldUnchanged = result!.oldSegments.filter(s => !s.changed).map(s => s.text).join('');
    expect(oldUnchanged).toBe('abc');
  });

  it('handles deletion (old longer than new)', () => {
    const result = charDiff('aXbYcZ', 'abc');
    expect(result).not.toBeNull();
    const newUnchanged = result!.newSegments.filter(s => !s.changed).map(s => s.text).join('');
    expect(newUnchanged).toBe('abc');
  });

  // Source-map and minified-bundle diffs frequently contain single
  // lines >100 KB long. The LCS table is O(m*n), so computing it
  // exhausted the Node heap and crashed the server when a user
  // selected such a file. charDiff must bail before allocating.
  it('returns null when either side exceeds the line-length cap', () => {
    const huge = 'x'.repeat(100_000);
    const small = 'xyz';
    const start = Date.now();
    expect(charDiff(huge, small)).toBeNull();
    expect(charDiff(small, huge)).toBeNull();
    expect(charDiff(huge, huge + 'y')).toBeNull();
    // Sanity check: the early-out should be effectively instant.
    expect(Date.now() - start).toBeLessThan(100);
  });
});
