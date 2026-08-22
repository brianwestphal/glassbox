import { beforeEach, describe, expect, it, vi } from 'vitest';

const existsSyncMock = vi.fn();
const readFileSyncMock = vi.fn();
const writeFileSyncMock = vi.fn();
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
  writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
}));

const isGitRepoMock = vi.fn();
vi.mock('../../../src/git/repo.js', () => ({
  isGitRepo: (cwd: string) => isGitRepoMock(cwd),
}));

const { computeGitignore, ensureGlassboxGitignored, ensureGlassboxGitignoredWithNotice, GITIGNORE_UPDATE_NOTICE, GLASSBOX_GITIGNORE_LINES } = await import(
  '../../../src/git/gitignore.js'
);

const BLOCK = GLASSBOX_GITIGNORE_LINES.join('\n');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computeGitignore', () => {
  it('creates a fresh file when none exists', () => {
    const { changed, content } = computeGitignore(null);
    expect(changed).toBe(true);
    expect(content).toBe(`${BLOCK}\n`);
  });

  it('creates the block for an empty/whitespace file', () => {
    expect(computeGitignore('').content).toBe(`${BLOCK}\n`);
    expect(computeGitignore('   \n').content).toBe(`${BLOCK}\n`);
  });

  it('is a no-op when the canonical block is already present', () => {
    const existing = `node_modules/\n${BLOCK}\ndist/\n`;
    const { changed, content } = computeGitignore(existing);
    expect(changed).toBe(false);
    expect(content).toBe(existing);
  });

  it('appends the block (with a blank separator) when no .glassbox entry exists', () => {
    const { changed, content } = computeGitignore('node_modules/\ndist/\n');
    expect(changed).toBe(true);
    expect(content).toBe(`node_modules/\ndist/\n\n${BLOCK}\n`);
  });

  it('handles a file with no trailing newline', () => {
    const { content } = computeGitignore('node_modules/');
    expect(content).toBe(`node_modules/\n\n${BLOCK}\n`);
  });

  it('replaces a stale bare ".glassbox/" entry with the canonical block', () => {
    const { changed, content } = computeGitignore('node_modules/\n.glassbox/\ndist/\n');
    expect(changed).toBe(true);
    expect(content).toBe(`node_modules/\n${BLOCK}\ndist/\n`);
  });

  it('replaces other stale variants (.glassbox, /.glassbox, /.glassbox/*)', () => {
    for (const stale of ['.glassbox', '/.glassbox', '/.glassbox/*', '.glassbox/*']) {
      const { content } = computeGitignore(`a\n${stale}\nb\n`);
      expect(content).toBe(`a\n${BLOCK}\nb\n`);
    }
  });

  it('collapses multiple stale .glassbox lines into one block at the first position', () => {
    const { content } = computeGitignore('a\n.glassbox/\nb\n/.glassbox\n!.glassbox/settings.json\nc\n');
    expect(content).toBe(`a\n${BLOCK}\nb\nc\n`);
  });

  it('respects an explicit opt-out via a commented rule (leaves the file untouched)', () => {
    const existing = 'node_modules/\n# /.glassbox/*\n';
    const { changed, content } = computeGitignore(existing);
    expect(changed).toBe(false);
    expect(content).toBe(existing);
  });

  it('treats any commented .glassbox variant as opt-out', () => {
    for (const c of ['#.glassbox', '# .glassbox/', '#  /.glassbox/*', '# !/.glassbox/settings.json']) {
      const existing = `a\n${c}\nb\n`;
      expect(computeGitignore(existing).changed).toBe(false);
    }
  });

  it('does not touch unrelated entries that merely contain the word glassbox', () => {
    // `glassbox-notes/` and `my.glassbox` are NOT our pattern (no leading `.glassbox` segment).
    const existing = 'glassbox-notes/\nmy.glassbox\n';
    const { changed, content } = computeGitignore(existing);
    expect(changed).toBe(true); // appends our block, keeps theirs
    expect(content).toBe(`glassbox-notes/\nmy.glassbox\n\n${BLOCK}\n`);
  });
});

describe('ensureGlassboxGitignored', () => {
  it('writes the updated .gitignore inside a git repo when a change is needed', () => {
    isGitRepoMock.mockReturnValue(true);
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue('node_modules/\n'); // no .glassbox block yet -> change needed

    const { changed } = ensureGlassboxGitignored('/repo/.glassbox');

    expect(changed).toBe(true);
    expect(isGitRepoMock).toHaveBeenCalledWith('/repo');
    expect(readFileSyncMock).toHaveBeenCalledWith('/repo/.gitignore', 'utf-8');
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      '/repo/.gitignore',
      `node_modules/\n\n${BLOCK}\n`,
      'utf-8'
    );
  });

  it('creates a fresh .gitignore when none exists in the repo', () => {
    isGitRepoMock.mockReturnValue(true);
    existsSyncMock.mockReturnValue(false); // no .gitignore -> computeGitignore(null)

    const { changed } = ensureGlassboxGitignored('/repo/.glassbox');

    expect(changed).toBe(true);
    expect(readFileSyncMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).toHaveBeenCalledWith('/repo/.gitignore', `${BLOCK}\n`, 'utf-8');
  });

  it('does not write when already up to date (no change needed)', () => {
    isGitRepoMock.mockReturnValue(true);
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(`node_modules/\n${BLOCK}\n`);

    const { changed } = ensureGlassboxGitignored('/repo/.glassbox');

    expect(changed).toBe(false);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('does not write when the target directory is not a git repo', () => {
    isGitRepoMock.mockReturnValue(false);

    const { changed } = ensureGlassboxGitignored('/somewhere/.glassbox');

    expect(changed).toBe(false);
    expect(isGitRepoMock).toHaveBeenCalledWith('/somewhere');
    expect(readFileSyncMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('does not write (or even check the repo) for a non-default data-dir name', () => {
    const { changed } = ensureGlassboxGitignored('/repo/.custom-data');

    expect(changed).toBe(false);
    expect(isGitRepoMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });
});

// FR-27.8: every launch path that writes `.glassbox/` prints a one-line notice
// when it changes `.gitignore`. Both the main review path and the difftool-serve
// path now route through this single helper (GB-1155), so testing it covers both.
describe('ensureGlassboxGitignoredWithNotice (FR-27.8)', () => {
  it('prints the notice when .gitignore was changed', () => {
    isGitRepoMock.mockReturnValue(true);
    existsSyncMock.mockReturnValue(false); // no file -> change needed
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    ensureGlassboxGitignoredWithNotice('/repo/.glassbox');

    expect(writeFileSyncMock).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(GITIGNORE_UPDATE_NOTICE);
    log.mockRestore();
  });

  it('stays silent when no change was needed', () => {
    isGitRepoMock.mockReturnValue(true);
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(`node_modules/\n${BLOCK}\n`); // already up to date
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    ensureGlassboxGitignoredWithNotice('/repo/.glassbox');

    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('stays silent outside a git repo (no notice, no write)', () => {
    isGitRepoMock.mockReturnValue(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    ensureGlassboxGitignoredWithNotice('/somewhere/.glassbox');

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
