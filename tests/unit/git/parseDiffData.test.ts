import { parseDiffData, unchangedFileDiff } from '../../../src/git/parseDiffData.js';

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

  it('round-trips an unchanged status through the schema (GB-1137)', () => {
    const diff = unchangedFileDiff('a.ts', 'x\n');
    const parsed = parseDiffData(JSON.stringify(diff));
    expect(parsed?.status).toBe('unchanged');
  });
});

describe('unchangedFileDiff (GB-1137)', () => {
  it('renders every line of the file as a context line, 1-indexed', () => {
    const diff = unchangedFileDiff('src/a.ts', 'alpha\nbeta\ngamma\n');
    expect(diff.status).toBe('unchanged');
    expect(diff.filePath).toBe('src/a.ts');
    expect(diff.hunks).toHaveLength(1);
    const hunk = diff.hunks[0];
    expect(hunk).toMatchObject({ oldStart: 1, newStart: 1, oldCount: 3, newCount: 3 });
    expect(hunk.lines).toEqual([
      { type: 'context', oldNum: 1, newNum: 1, content: 'alpha' },
      { type: 'context', oldNum: 2, newNum: 2, content: 'beta' },
      { type: 'context', oldNum: 3, newNum: 3, content: 'gamma' },
    ]);
  });

  it('drops the phantom last line from a single trailing newline', () => {
    // "a\nb\n" is two lines, not three — the final "" segment is dropped.
    expect(unchangedFileDiff('f', 'a\nb\n').hunks[0].lines.map(l => l.content)).toEqual(['a', 'b']);
    // A file WITHOUT a trailing newline keeps its last line.
    expect(unchangedFileDiff('f', 'a\nb').hunks[0].lines.map(l => l.content)).toEqual(['a', 'b']);
    // A genuine trailing blank line (two newlines) is preserved.
    expect(unchangedFileDiff('f', 'a\n\n').hunks[0].lines.map(l => l.content)).toEqual(['a', '']);
  });

  it('yields no hunks for an empty file but stays a valid unchanged diff', () => {
    const diff = unchangedFileDiff('empty.ts', '');
    expect(diff.status).toBe('unchanged');
    expect(diff.hunks).toEqual([]);
  });
});
