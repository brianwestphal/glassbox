import { describe, expect, it } from 'vitest';

import { computeGitignore, GLASSBOX_GITIGNORE_LINES } from '../../../src/git/gitignore.js';

const BLOCK = GLASSBOX_GITIGNORE_LINES.join('\n');

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
