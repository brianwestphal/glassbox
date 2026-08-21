/**
 * GB-1142 — resolveNoteOrigins fills each note's origin-commit subject/message
 * from git (cached per sha), leaving pre-filled or unresolvable ones alone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCommitInfoMock = vi.fn<(cwd: string, sha: string) => { shortSha: string; subject: string; message: string } | null>();
vi.mock('../../../src/git/repo.js', () => ({
  getCommitInfo: (cwd: string, sha: string) => getCommitInfoMock(cwd, sha),
}));

const { resolveNoteOrigins } = await import('../../../src/review-notes/origin.js');
import type { ReviewNoteView } from '../../../src/review-notes/view.js';

function note(over: Partial<ReviewNoteView> = {}): ReviewNoteView {
  return { line: 1, side: 'new', kind: 'rationale', body: 'b', ...over };
}

beforeEach(() => { getCommitInfoMock.mockReset(); });

describe('resolveNoteOrigins', () => {
  it('fills subject/message/shortSha from git for a note carrying only a sha', () => {
    getCommitInfoMock.mockReturnValue({ shortSha: 'abc1234', subject: 'Do a thing', message: 'Do a thing\n\nbody' });
    const notes = [note({ origin: { sha: 'abc1234deadbeef', shortSha: 'abc1234d' } })];
    resolveNoteOrigins('/repo', notes);
    expect(notes[0].origin).toEqual({ sha: 'abc1234deadbeef', shortSha: 'abc1234', subject: 'Do a thing', message: 'Do a thing\n\nbody' });
  });

  it('leaves an already-resolved note alone (demo notes) and does not call git', () => {
    const notes = [note({ origin: { sha: 'x', shortSha: 'x', subject: 'pre-set', message: 'm' } })];
    resolveNoteOrigins('/repo', notes);
    expect(getCommitInfoMock).not.toHaveBeenCalled();
    expect(notes[0].origin?.subject).toBe('pre-set');
  });

  it('leaves a note with no origin untouched', () => {
    const notes = [note()];
    resolveNoteOrigins('/repo', notes);
    expect(notes[0].origin).toBeUndefined();
    expect(getCommitInfoMock).not.toHaveBeenCalled();
  });

  it('degrades to the short hash when git can not resolve the sha', () => {
    getCommitInfoMock.mockReturnValue(null);
    const notes = [note({ origin: { sha: 'gone', shortSha: 'gone' } })];
    resolveNoteOrigins('/repo', notes);
    expect(notes[0].origin).toEqual({ sha: 'gone', shortSha: 'gone' });
  });

  it('resolves each distinct sha only once (cached)', () => {
    getCommitInfoMock.mockReturnValue({ shortSha: 's', subject: 'sub', message: 'msg' });
    const notes = [
      note({ origin: { sha: 'same', shortSha: 'same' } }),
      note({ origin: { sha: 'same', shortSha: 'same' } }),
    ];
    resolveNoteOrigins('/repo', notes);
    expect(getCommitInfoMock).toHaveBeenCalledTimes(1);
    expect(notes[1].origin?.subject).toBe('sub');
  });
});
