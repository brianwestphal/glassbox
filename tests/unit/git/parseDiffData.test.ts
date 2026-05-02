import { parseDiffData } from '../../../src/git/parseDiffData.js';

describe('parseDiffData', () => {
  it('returns null for null', () => {
    expect(parseDiffData(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseDiffData(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDiffData('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseDiffData('not json')).toBeNull();
    expect(parseDiffData('{')).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    expect(parseDiffData('"string"')).toBeNull();
    expect(parseDiffData('42')).toBeNull();
    expect(parseDiffData('null')).toBeNull();
  });

  it('returns the parsed object for valid JSON', () => {
    const sample = JSON.stringify({
      filePath: 'a.ts',
      oldPath: null,
      status: 'modified',
      hunks: [],
      isBinary: false,
    });
    const parsed = parseDiffData(sample);
    expect(parsed).not.toBeNull();
    expect(parsed?.filePath).toBe('a.ts');
    expect(parsed?.status).toBe('modified');
  });
});
