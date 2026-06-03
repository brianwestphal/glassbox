import { describe, expect, it } from 'vitest';

import { diffRawContent } from '../../../src/git/diff.js';

// doc 19, FR-19.7 — the accumulating difftool append endpoint produces a
// FileDiff from two raw buffers (the wrapper has already read $LOCAL / $REMOTE
// before git deletes the temp files). Exercises the real `git diff --no-index`
// engine, so git must be on PATH (it is in CI and dev).

const buf = (s: string): Buffer => Buffer.from(s, 'utf-8');

describe('diffRawContent', () => {
  it('produces a modified-file diff with add/remove lines', () => {
    const diff = diffRawContent('src/example.ts', buf('a\nb\nc\n'), buf('a\nB\nc\n'));
    expect(diff.filePath).toBe('src/example.ts');
    expect(diff.isBinary).toBe(false);
    const lines = diff.hunks.flatMap((h) => h.lines);
    expect(lines.some((l) => l.type === 'remove' && l.content === 'b')).toBe(true);
    expect(lines.some((l) => l.type === 'add' && l.content === 'B')).toBe(true);
  });

  it('reports an empty old side as an added file', () => {
    const diff = diffRawContent('new.txt', buf(''), buf('hello\nworld\n'));
    expect(diff.status).toBe('added');
    const added = diff.hunks.flatMap((h) => h.lines).filter((l) => l.type === 'add');
    expect(added.map((l) => l.content)).toEqual(['hello', 'world']);
  });

  it('reports an empty new side as a deleted file', () => {
    const diff = diffRawContent('gone.txt', buf('bye\n'), buf(''));
    expect(diff.status).toBe('deleted');
  });

  it('marks differing binary content as binary', () => {
    const oldBin = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]);
    const newBin = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xfe]);
    const diff = diffRawContent('image.png', oldBin, newBin);
    expect(diff.isBinary).toBe(true);
    expect(diff.hunks).toEqual([]);
  });

  it('neutralizes a parent-escaping display path so it stays inside the temp tree', () => {
    const diff = diffRawContent('../../etc/passwd', buf('a\n'), buf('b\n'));
    expect(diff.filePath).not.toContain('..');
    expect(diff.filePath.startsWith('/')).toBe(false);
  });
});
