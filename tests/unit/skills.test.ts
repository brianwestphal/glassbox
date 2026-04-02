import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);

import { SKILL_VERSION, ensureSkills } from '../../src/skills.js';

describe('ensureSkills', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('');
    mockWriteFileSync.mockReturnValue(undefined);
    mockMkdirSync.mockReturnValue(undefined as any);
  });

  it('creates Claude skill file when .claude directory exists', () => {
    const cwd = process.cwd();
    mockExistsSync.mockImplementation((path: any) => {
      if (path === join(cwd, '.claude')) return true;
      return false;
    });

    const result = ensureSkills();

    expect(result).toContain('Claude Code');
    expect(mockMkdirSync).toHaveBeenCalledWith(
      join(cwd, '.claude', 'skills', 'glassbox'),
      { recursive: true }
    );
    const writeCall = mockWriteFileSync.mock.calls.find(
      c => typeof c[0] === 'string' && (c[0] as string).includes('SKILL.md')
    );
    expect(writeCall).toBeDefined();
    expect(writeCall![1]).toContain('glassbox-skill-version');
  });

  it('creates Cursor rules file when .cursor directory exists', () => {
    const cwd = process.cwd();
    mockExistsSync.mockImplementation((path: any) => {
      if (path === join(cwd, '.cursor')) return true;
      return false;
    });

    const result = ensureSkills();

    expect(result).toContain('Cursor');
    expect(mockMkdirSync).toHaveBeenCalledWith(
      join(cwd, '.cursor', 'rules'),
      { recursive: true }
    );
    const writeCall = mockWriteFileSync.mock.calls.find(
      c => typeof c[0] === 'string' && (c[0] as string).includes('glassbox.mdc')
    );
    expect(writeCall).toBeDefined();
  });

  it('creates GitHub Copilot prompt when .github/prompts directory exists', () => {
    const cwd = process.cwd();
    mockExistsSync.mockImplementation((path: any) => {
      if (path === join(cwd, '.github', 'prompts')) return true;
      return false;
    });

    const result = ensureSkills();

    expect(result).toContain('GitHub Copilot');
    const writeCall = mockWriteFileSync.mock.calls.find(
      c => typeof c[0] === 'string' && (c[0] as string).includes('glassbox.prompt.md')
    );
    expect(writeCall).toBeDefined();
  });

  it('creates GitHub Copilot prompt when copilot-instructions.md exists', () => {
    const cwd = process.cwd();
    mockExistsSync.mockImplementation((path: any) => {
      if (path === join(cwd, '.github', 'copilot-instructions.md')) return true;
      return false;
    });

    const result = ensureSkills();

    expect(result).toContain('GitHub Copilot');
  });

  it('creates Windsurf rules file when .windsurf directory exists', () => {
    const cwd = process.cwd();
    mockExistsSync.mockImplementation((path: any) => {
      if (path === join(cwd, '.windsurf')) return true;
      return false;
    });

    const result = ensureSkills();

    expect(result).toContain('Windsurf');
    expect(mockMkdirSync).toHaveBeenCalledWith(
      join(cwd, '.windsurf', 'rules'),
      { recursive: true }
    );
    const writeCall = mockWriteFileSync.mock.calls.find(
      c => typeof c[0] === 'string' && (c[0] as string).endsWith('glassbox.md')
    );
    expect(writeCall).toBeDefined();
  });

  it('returns empty array when no platform directories exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = ensureSkills();

    expect(result).toEqual([]);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('skips creation when existing file has current version', () => {
    const cwd = process.cwd();
    const currentVersionHeader = `<!-- glassbox-skill-version: ${SKILL_VERSION} -->`;

    mockExistsSync.mockImplementation((path: any) => {
      const p = path as string;
      if (p === join(cwd, '.claude')) return true;
      if (p.includes('SKILL.md')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(`---\nname: glassbox\n---\n${currentVersionHeader}\nold content`);

    const result = ensureSkills();

    expect(result).not.toContain('Claude Code');
    const skillWrites = mockWriteFileSync.mock.calls.filter(
      c => typeof c[0] === 'string' && (c[0] as string).includes('SKILL.md')
    );
    expect(skillWrites).toHaveLength(0);
  });

  it('updates file when existing version is outdated', () => {
    const cwd = process.cwd();
    const oldVersionHeader = `<!-- glassbox-skill-version: 0 -->`;

    mockExistsSync.mockImplementation((path: any) => {
      const p = path as string;
      if (p === join(cwd, '.claude')) return true;
      if (p.includes('SKILL.md')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(`---\nname: glassbox\n---\n${oldVersionHeader}\nold content`);

    const result = ensureSkills();

    expect(result).toContain('Claude Code');
    const skillWrites = mockWriteFileSync.mock.calls.filter(
      c => typeof c[0] === 'string' && (c[0] as string).includes('SKILL.md')
    );
    expect(skillWrites).toHaveLength(1);
    expect(skillWrites[0][1]).toContain(`glassbox-skill-version: ${SKILL_VERSION}`);
  });

  it('updates file when existing file has no version header', () => {
    const cwd = process.cwd();

    mockExistsSync.mockImplementation((path: any) => {
      const p = path as string;
      if (p === join(cwd, '.claude')) return true;
      if (p.includes('SKILL.md')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue('---\nname: glassbox\n---\nold content without version');

    const result = ensureSkills();

    expect(result).toContain('Claude Code');
  });

  it('creates files for all platforms when all directories exist', () => {
    const cwd = process.cwd();
    mockExistsSync.mockImplementation((path: any) => {
      const p = path as string;
      if (p === join(cwd, '.claude')) return true;
      if (p === join(cwd, '.cursor')) return true;
      if (p === join(cwd, '.github', 'prompts')) return true;
      if (p === join(cwd, '.windsurf')) return true;
      return false;
    });

    const result = ensureSkills();

    expect(result).toContain('Claude Code');
    expect(result).toContain('Cursor');
    expect(result).toContain('GitHub Copilot');
    expect(result).toContain('Windsurf');
    expect(result).toHaveLength(4);
  });

  it('skill file content includes annotation instructions', () => {
    const cwd = process.cwd();
    mockExistsSync.mockImplementation((path: any) => {
      if (path === join(cwd, '.claude')) return true;
      return false;
    });

    ensureSkills();

    const writeCall = mockWriteFileSync.mock.calls.find(
      c => typeof c[0] === 'string' && (c[0] as string).includes('SKILL.md')
    );
    expect(writeCall).toBeDefined();
    const content = writeCall![1] as string;
    expect(content).toContain('latest-review.md');
    expect(content).toContain('bug');
    expect(content).toContain('fix');
    expect(content).toContain('style');
    expect(content).toContain('pattern-follow');
    expect(content).toContain('pattern-avoid');
    expect(content).toContain('remember');
    expect(content).toContain('note');
  });
});
