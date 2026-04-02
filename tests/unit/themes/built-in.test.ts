import {
  BUILT_IN_THEMES, DEFAULT_THEME_ID, getBuiltInTheme,
  THEME_VARIABLES, themeToInlineStyle,
} from '../../../src/themes/built-in.js';
import type { ThemeColors } from '../../../src/themes/built-in.js';

describe('BUILT_IN_THEMES', () => {
  it('has 6 built-in themes', () => {
    expect(BUILT_IN_THEMES).toHaveLength(6);
  });

  it('includes Dark, Light, High Contrast Dark, High Contrast Light, Dracula, Tokyo Night', () => {
    const ids = BUILT_IN_THEMES.map(t => t.id);
    expect(ids).toEqual(['dark', 'light', 'high-contrast-dark', 'high-contrast-light', 'dracula', 'tokyo-night']);
  });

  it('all themes are marked as builtIn: true', () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.builtIn).toBe(true);
    }
  });

  it('all themes have unique IDs', () => {
    const ids = BUILT_IN_THEMES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all themes have unique names', () => {
    const names = BUILT_IN_THEMES.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every theme defines all required color variables', () => {
    for (const theme of BUILT_IN_THEMES) {
      for (const varName of THEME_VARIABLES) {
        expect(theme.colors[varName]).toBeDefined();
        expect(typeof theme.colors[varName]).toBe('string');
        expect(theme.colors[varName].length).toBeGreaterThan(0);
      }
    }
  });

  it('Dark theme has dark background colors', () => {
    const dark = BUILT_IN_THEMES.find(t => t.id === 'dark')!;
    expect(dark.colors.bg).toBe('#1e1e2e');
    expect(dark.colors['text-bright']).toBe('#ffffff');
  });

  it('Light theme has light background colors', () => {
    const light = BUILT_IN_THEMES.find(t => t.id === 'light')!;
    expect(light.colors.bg).toBe('#ffffff');
    expect(light.colors['text-bright']).toBe('#000000');
  });
});

describe('DEFAULT_THEME_ID', () => {
  it('is dark', () => {
    expect(DEFAULT_THEME_ID).toBe('dark');
  });

  it('corresponds to an existing built-in theme', () => {
    expect(BUILT_IN_THEMES.find(t => t.id === DEFAULT_THEME_ID)).toBeDefined();
  });
});

describe('THEME_VARIABLES', () => {
  it('has 24 variables', () => {
    expect(THEME_VARIABLES).toHaveLength(24);
  });

  it('includes all background variables', () => {
    expect(THEME_VARIABLES).toContain('bg');
    expect(THEME_VARIABLES).toContain('bg-surface');
    expect(THEME_VARIABLES).toContain('bg-hover');
    expect(THEME_VARIABLES).toContain('bg-active');
  });

  it('includes all text variables', () => {
    expect(THEME_VARIABLES).toContain('text');
    expect(THEME_VARIABLES).toContain('text-dim');
    expect(THEME_VARIABLES).toContain('text-bright');
  });

  it('includes diff variables', () => {
    expect(THEME_VARIABLES).toContain('diff-add-bg');
    expect(THEME_VARIABLES).toContain('diff-remove-bg');
    expect(THEME_VARIABLES).toContain('diff-context-bg');
  });

  it('includes gutter variables', () => {
    expect(THEME_VARIABLES).toContain('gutter-bg');
    expect(THEME_VARIABLES).toContain('gutter-text');
  });
});

describe('getBuiltInTheme', () => {
  it('returns a theme by ID', () => {
    const theme = getBuiltInTheme('dark');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('dark');
    expect(theme!.name).toBe('Dark');
  });

  it('returns undefined for unknown ID', () => {
    expect(getBuiltInTheme('nonexistent')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(getBuiltInTheme('')).toBeUndefined();
  });

  it('finds each built-in theme', () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(getBuiltInTheme(theme.id)).toBe(theme);
    }
  });
});

describe('themeToInlineStyle', () => {
  it('generates CSS custom property declarations', () => {
    const colors: ThemeColors = {
      'bg': '#111', 'bg-surface': '#222', 'bg-hover': '#333', 'bg-active': '#444',
      'text': '#eee', 'text-dim': '#999', 'text-bright': '#fff',
      'accent': '#00f', 'accent-hover': '#33f',
      'green': '#0f0', 'red': '#f00', 'yellow': '#ff0', 'orange': '#f80',
      'blue': '#00f', 'purple': '#80f', 'teal': '#0ff',
      'border': '#555',
      'diff-add-bg': 'rgba(0,255,0,0.1)', 'diff-add-border': 'rgba(0,255,0,0.3)',
      'diff-remove-bg': 'rgba(255,0,0,0.1)', 'diff-remove-border': 'rgba(255,0,0,0.3)',
      'diff-context-bg': 'transparent',
      'gutter-bg': '#000', 'gutter-text': '#666',
    };
    const style = themeToInlineStyle(colors);
    expect(style).toContain('--bg:#111');
    expect(style).toContain('--text:#eee');
    expect(style).toContain('--accent:#00f');
    expect(style).toContain('--diff-add-bg:rgba(0,255,0,0.1)');
    expect(style).toContain('--gutter-text:#666');
  });

  it('includes all 24 variables', () => {
    const dark = BUILT_IN_THEMES[0].colors;
    const style = themeToInlineStyle(dark);
    const count = (style.match(/--/g) ?? []).length;
    expect(count).toBe(24);
  });

  it('separates declarations with semicolons', () => {
    const dark = BUILT_IN_THEMES[0].colors;
    const style = themeToInlineStyle(dark);
    const parts = style.split(';');
    expect(parts.length).toBe(24);
  });
});
