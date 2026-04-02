vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import {
  deleteCustomTheme, generateThemeId, getActiveThemeColors, getActiveThemeId,
  getAllThemes, getCustomTheme, loadCustomThemes, resolveTheme,
  saveCustomTheme, setActiveThemeId,
} from '../../../src/themes/config.js';
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from '../../../src/themes/built-in.js';
import type { CustomTheme, ThemeColors } from '../../../src/themes/built-in.js';

function makeCustomTheme(overrides: Partial<CustomTheme> = {}): CustomTheme {
  return {
    id: 'custom-1', name: 'My Theme', builtIn: false, baseTheme: 'dark',
    colors: { ...BUILT_IN_THEMES[0].colors },
    ...overrides,
  };
}

describe('getActiveThemeId', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns default theme when no config exists', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(getActiveThemeId()).toBe(DEFAULT_THEME_ID);
  });

  it('returns active theme from config', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ theme: { active: 'dracula' } }));
    expect(getActiveThemeId()).toBe('dracula');
  });

  it('returns default on corrupt config', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('not json');
    expect(getActiveThemeId()).toBe(DEFAULT_THEME_ID);
  });

  it('returns default when theme section missing', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ ai: {} }));
    expect(getActiveThemeId()).toBe(DEFAULT_THEME_ID);
  });
});

describe('setActiveThemeId', () => {
  beforeEach(() => vi.resetAllMocks());

  it('writes theme.active to config', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    setActiveThemeId('light');
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.theme.active).toBe('light');
  });

  it('preserves existing config sections', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ ai: { platform: 'anthropic' } }));
    setActiveThemeId('dracula');
    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.ai.platform).toBe('anthropic');
    expect(written.theme.active).toBe('dracula');
  });
});

describe('loadCustomThemes', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns empty array when themes dir does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(loadCustomThemes()).toEqual([]);
  });

  it('loads valid theme files', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['theme1.json', 'theme2.json'] as any);
    const theme = makeCustomTheme();
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(theme));
    const themes = loadCustomThemes();
    expect(themes).toHaveLength(2);
    expect(themes[0].builtIn).toBe(false);
  });

  it('skips non-json files', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['readme.txt', 'theme.json'] as any);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(makeCustomTheme()));
    const themes = loadCustomThemes();
    expect(themes).toHaveLength(1);
  });

  it('skips corrupt theme files', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['bad.json', 'good.json'] as any);
    vi.mocked(readFileSync)
      .mockReturnValueOnce('not json')
      .mockReturnValueOnce(JSON.stringify(makeCustomTheme()));
    const themes = loadCustomThemes();
    expect(themes).toHaveLength(1);
  });

  it('skips files missing required fields', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['incomplete.json'] as any);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ id: 'x' })); // missing name and colors
    expect(loadCustomThemes()).toHaveLength(0);
  });
});

describe('saveCustomTheme', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates themes dir and writes JSON', () => {
    const theme = makeCustomTheme();
    saveCustomTheme(theme);
    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('themes'), { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('custom-1.json'),
      expect.any(String), 'utf-8',
    );
    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.id).toBe('custom-1');
    expect(written.name).toBe('My Theme');
  });
});

describe('deleteCustomTheme', () => {
  beforeEach(() => vi.resetAllMocks());

  it('deletes the theme file if it exists', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    deleteCustomTheme('custom-1');
    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('custom-1.json'));
  });

  it('does nothing if file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    deleteCustomTheme('nonexistent');
    expect(unlinkSync).not.toHaveBeenCalled();
  });
});

describe('getCustomTheme', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns a custom theme by ID', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(makeCustomTheme()));
    const theme = getCustomTheme('custom-1');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('custom-1');
    expect(theme!.builtIn).toBe(false);
  });

  it('returns undefined if file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(getCustomTheme('nope')).toBeUndefined();
  });

  it('returns undefined on corrupt file', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('not json');
    expect(getCustomTheme('bad')).toBeUndefined();
  });
});

describe('getAllThemes', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns built-in themes when no custom themes exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const themes = getAllThemes();
    expect(themes.length).toBe(BUILT_IN_THEMES.length);
  });

  it('returns built-in + custom themes', () => {
    // existsSync: first call for themes dir (true), second for each file
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['c1.json'] as any);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(makeCustomTheme()));
    const themes = getAllThemes();
    expect(themes.length).toBe(BUILT_IN_THEMES.length + 1);
  });
});

describe('resolveTheme', () => {
  beforeEach(() => vi.resetAllMocks());

  it('resolves built-in theme', () => {
    const theme = resolveTheme('dark');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('dark');
    expect(theme!.builtIn).toBe(true);
  });

  it('resolves custom theme', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(makeCustomTheme()));
    const theme = resolveTheme('custom-1');
    expect(theme).toBeDefined();
    expect(theme!.builtIn).toBe(false);
  });

  it('returns undefined for unknown theme', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(resolveTheme('nonexistent')).toBeUndefined();
  });
});

describe('getActiveThemeColors', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns colors for the active theme', () => {
    vi.mocked(existsSync).mockImplementation((path: any) => {
      return String(path).endsWith('config.json');
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ theme: { active: 'light' } }));
    const colors = getActiveThemeColors();
    expect(colors.bg).toBe('#ffffff'); // Light theme
  });

  it('falls back to dark theme if active theme is missing', () => {
    vi.mocked(existsSync).mockImplementation((path: any) => {
      return String(path).endsWith('config.json');
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ theme: { active: 'deleted-theme' } }));
    const colors = getActiveThemeColors();
    expect(colors.bg).toBe('#1e1e2e'); // Dark theme
  });
});

describe('generateThemeId', () => {
  it('returns a non-empty string', () => {
    const id = generateThemeId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(5);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateThemeId()));
    expect(ids.size).toBe(20);
  });
});
