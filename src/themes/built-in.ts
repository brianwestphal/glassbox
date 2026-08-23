/**
 * Built-in theme definitions. Each theme maps CSS custom property names to values.
 * These are the same variables defined in _variables.scss :root (which serves as fallback).
 */

export interface ThemeColors {
  'bg': string;
  'bg-surface': string;
  'bg-hover': string;
  'bg-active': string;
  'text': string;
  'text-dim': string;
  'text-bright': string;
  'accent': string;
  'accent-hover': string;
  'green': string;
  'red': string;
  'yellow': string;
  'orange': string;
  'blue': string;
  'purple': string;
  'teal': string;
  'border': string;
  'diff-add-bg': string;
  'diff-add-border': string;
  'diff-remove-bg': string;
  'diff-remove-border': string;
  'diff-context-bg': string;
  'gutter-bg': string;
  'gutter-text': string;
}

/** View `ThemeColors` as a plain string→string map for keyed iteration (swatch
 *  loops, live-preview color edits). Every `ThemeColors` value is a string, so
 *  this is a safe widening — centralizes what were repeated `as unknown as`
 *  casts at the call sites. */
export function themeColorsToRecord(colors: ThemeColors): Record<string, string> {
  return colors as unknown as Record<string, string>;
}

export interface BuiltInTheme {
  id: string;
  name: string;
  builtIn: true;
  colors: ThemeColors;
}

export interface CustomTheme {
  id: string;
  name: string;
  builtIn: false;
  baseTheme: string;
  colors: ThemeColors;
}

export type Theme = BuiltInTheme | CustomTheme;

/** All CSS variable names that themes control. */
export const THEME_VARIABLES: (keyof ThemeColors)[] = [
  'bg', 'bg-surface', 'bg-hover', 'bg-active',
  'text', 'text-dim', 'text-bright',
  'accent', 'accent-hover',
  'green', 'red', 'yellow', 'orange', 'blue', 'purple', 'teal',
  'border',
  'diff-add-bg', 'diff-add-border', 'diff-remove-bg', 'diff-remove-border', 'diff-context-bg',
  'gutter-bg', 'gutter-text',
];

// --- Dark (default) — Catppuccin Mocha-inspired ---

const dark: ThemeColors = {
  'bg': '#1e1e2e',
  'bg-surface': '#252536',
  'bg-hover': '#2d2d44',
  'bg-active': '#363652',
  'text': '#cdd6f4',
  // GB-1164: nudged lighter from #8888aa so dim text clears WCAG AA (4.5:1) on
  // both --bg (5.6:1) and --bg-surface (5.2:1); the old value was ~4.4:1 on the
  // surface (settings/modals/cards). Still a muted lavender-gray.
  'text-dim': '#9494b8',
  'text-bright': '#ffffff',
  'accent': '#89b4fa',
  'accent-hover': '#74a8fc',
  'green': '#a6e3a1',
  'red': '#f38ba8',
  'yellow': '#f9e2af',
  'orange': '#fab387',
  'blue': '#89b4fa',
  'purple': '#cba6f7',
  'teal': '#94e2d5',
  'border': '#363652',
  'diff-add-bg': 'rgba(166, 227, 161, 0.1)',
  'diff-add-border': 'rgba(166, 227, 161, 0.3)',
  'diff-remove-bg': 'rgba(243, 139, 168, 0.1)',
  'diff-remove-border': 'rgba(243, 139, 168, 0.3)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#1a1a2e',
  'gutter-text': '#555577',
};

// --- Light — GitHub Light-inspired ---

const light: ThemeColors = {
  'bg': '#ffffff',
  'bg-surface': '#f6f8fa',
  'bg-hover': '#eaeef2',
  'bg-active': '#dde3e9',
  'text': '#1f2328',
  'text-dim': '#656d76',
  'text-bright': '#000000',
  'accent': '#0969da',
  'accent-hover': '#0550ae',
  'green': '#1a7f37',
  'red': '#cf222e',
  'yellow': '#9a6700',
  'orange': '#bc4c00',
  'blue': '#0969da',
  'purple': '#8250df',
  'teal': '#0e7c6b',
  'border': '#d0d7de',
  'diff-add-bg': 'rgba(26, 127, 55, 0.08)',
  'diff-add-border': 'rgba(26, 127, 55, 0.25)',
  'diff-remove-bg': 'rgba(207, 34, 46, 0.08)',
  'diff-remove-border': 'rgba(207, 34, 46, 0.25)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#f6f8fa',
  'gutter-text': '#8b949e',
};

// --- High Contrast Dark — WCAG AAA ---

const highContrastDark: ThemeColors = {
  'bg': '#0a0a0a',
  'bg-surface': '#1a1a1a',
  'bg-hover': '#2a2a2a',
  'bg-active': '#3a3a3a',
  'text': '#f0f0f0',
  'text-dim': '#b0b0b0',
  'text-bright': '#ffffff',
  'accent': '#6db3f2',
  'accent-hover': '#8ec5f7',
  'green': '#73e06e',
  'red': '#ff6b6b',
  'yellow': '#ffd93d',
  'orange': '#ffab57',
  'blue': '#6db3f2',
  'purple': '#c59eff',
  'teal': '#5ee6d0',
  'border': '#555555',
  'diff-add-bg': 'rgba(115, 224, 110, 0.15)',
  'diff-add-border': 'rgba(115, 224, 110, 0.5)',
  'diff-remove-bg': 'rgba(255, 107, 107, 0.15)',
  'diff-remove-border': 'rgba(255, 107, 107, 0.5)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#111111',
  'gutter-text': '#888888',
};

// --- High Contrast Light — WCAG AAA ---

const highContrastLight: ThemeColors = {
  'bg': '#ffffff',
  'bg-surface': '#f0f0f0',
  'bg-hover': '#e0e0e0',
  'bg-active': '#d0d0d0',
  'text': '#111111',
  'text-dim': '#444444',
  'text-bright': '#000000',
  'accent': '#0043a8',
  'accent-hover': '#003080',
  'green': '#006b1f',
  'red': '#b80000',
  'yellow': '#785600',
  'orange': '#8a3400',
  'blue': '#0043a8',
  'purple': '#5b21b6',
  'teal': '#005e4f',
  'border': '#767676',
  'diff-add-bg': 'rgba(0, 107, 31, 0.1)',
  'diff-add-border': 'rgba(0, 107, 31, 0.4)',
  'diff-remove-bg': 'rgba(184, 0, 0, 0.1)',
  'diff-remove-border': 'rgba(184, 0, 0, 0.4)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#f0f0f0',
  'gutter-text': '#555555',
};

// --- Dracula ---

const dracula: ThemeColors = {
  'bg': '#282a36',
  'bg-surface': '#2d303e',
  'bg-hover': '#343746',
  'bg-active': '#3e4151',
  'text': '#f8f8f2',
  'text-dim': '#8b8da4',
  'text-bright': '#ffffff',
  'accent': '#bd93f9',
  'accent-hover': '#caa5fb',
  'green': '#50fa7b',
  'red': '#ff5555',
  'yellow': '#f1fa8c',
  'orange': '#ffb86c',
  'blue': '#8be9fd',
  'purple': '#bd93f9',
  'teal': '#8be9fd',
  'border': '#44475a',
  'diff-add-bg': 'rgba(80, 250, 123, 0.1)',
  'diff-add-border': 'rgba(80, 250, 123, 0.3)',
  'diff-remove-bg': 'rgba(255, 85, 85, 0.1)',
  'diff-remove-border': 'rgba(255, 85, 85, 0.3)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#21222c',
  'gutter-text': '#6272a4',
};

// --- Tokyo Night ---

const tokyoNight: ThemeColors = {
  'bg': '#1a1b26',
  'bg-surface': '#1f2233',
  'bg-hover': '#292d42',
  'bg-active': '#33374e',
  'text': '#a9b1d6',
  'text-dim': '#565f89',
  'text-bright': '#c0caf5',
  'accent': '#7aa2f7',
  'accent-hover': '#89b0fa',
  'green': '#9ece6a',
  'red': '#f7768e',
  'yellow': '#e0af68',
  'orange': '#ff9e64',
  'blue': '#7aa2f7',
  'purple': '#bb9af7',
  'teal': '#73daca',
  'border': '#2f3351',
  'diff-add-bg': 'rgba(158, 206, 106, 0.1)',
  'diff-add-border': 'rgba(158, 206, 106, 0.3)',
  'diff-remove-bg': 'rgba(247, 118, 142, 0.1)',
  'diff-remove-border': 'rgba(247, 118, 142, 0.3)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#16172a',
  'gutter-text': '#3b4261',
};

// --- One Dark Pro ---

const oneDarkPro: ThemeColors = {
  'bg': '#282c34',
  'bg-surface': '#2c313a',
  'bg-hover': '#333842',
  'bg-active': '#3b4048',
  'text': '#abb2bf',
  'text-dim': '#636d83',
  'text-bright': '#d7dae0',
  'accent': '#61afef',
  'accent-hover': '#519fdf',
  'green': '#98c379',
  'red': '#e06c75',
  'yellow': '#e5c07b',
  'orange': '#d19a66',
  'blue': '#61afef',
  'purple': '#c678dd',
  'teal': '#56b6c2',
  'border': '#3b4048',
  'diff-add-bg': 'rgba(152, 195, 121, 0.1)',
  'diff-add-border': 'rgba(152, 195, 121, 0.3)',
  'diff-remove-bg': 'rgba(224, 108, 117, 0.1)',
  'diff-remove-border': 'rgba(224, 108, 117, 0.3)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#23272e',
  'gutter-text': '#495162',
};

// --- Solarized Dark ---

const solarizedDark: ThemeColors = {
  'bg': '#002b36',
  'bg-surface': '#073642',
  'bg-hover': '#0a4050',
  'bg-active': '#0d4d5e',
  'text': '#839496',
  'text-dim': '#586e75',
  'text-bright': '#eee8d5',
  'accent': '#268bd2',
  'accent-hover': '#1a7cc0',
  'green': '#859900',
  'red': '#dc322f',
  'yellow': '#b58900',
  'orange': '#cb4b16',
  'blue': '#268bd2',
  'purple': '#6c71c4',
  'teal': '#2aa198',
  'border': '#0a4050',
  'diff-add-bg': 'rgba(133, 153, 0, 0.12)',
  'diff-add-border': 'rgba(133, 153, 0, 0.3)',
  'diff-remove-bg': 'rgba(220, 50, 47, 0.12)',
  'diff-remove-border': 'rgba(220, 50, 47, 0.3)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#002028',
  'gutter-text': '#4a6568',
};

// --- Solarized Light ---

const solarizedLight: ThemeColors = {
  'bg': '#fdf6e3',
  'bg-surface': '#eee8d5',
  'bg-hover': '#e6dfca',
  'bg-active': '#ddd6c1',
  'text': '#657b83',
  'text-dim': '#93a1a1',
  'text-bright': '#073642',
  'accent': '#268bd2',
  'accent-hover': '#1a7cc0',
  'green': '#859900',
  'red': '#dc322f',
  'yellow': '#b58900',
  'orange': '#cb4b16',
  'blue': '#268bd2',
  'purple': '#6c71c4',
  'teal': '#2aa198',
  'border': '#ddd6c1',
  'diff-add-bg': 'rgba(133, 153, 0, 0.1)',
  'diff-add-border': 'rgba(133, 153, 0, 0.25)',
  'diff-remove-bg': 'rgba(220, 50, 47, 0.1)',
  'diff-remove-border': 'rgba(220, 50, 47, 0.25)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#eee8d5',
  'gutter-text': '#93a1a1',
};

// --- Monokai ---

const monokai: ThemeColors = {
  'bg': '#272822',
  'bg-surface': '#2d2e27',
  'bg-hover': '#3e3d32',
  'bg-active': '#49483e',
  'text': '#f8f8f2',
  'text-dim': '#75715e',
  'text-bright': '#ffffff',
  'accent': '#66d9ef',
  'accent-hover': '#55c8de',
  'green': '#a6e22e',
  'red': '#f92672',
  'yellow': '#e6db74',
  'orange': '#fd971f',
  'blue': '#66d9ef',
  'purple': '#ae81ff',
  'teal': '#66d9ef',
  'border': '#49483e',
  'diff-add-bg': 'rgba(166, 226, 46, 0.1)',
  'diff-add-border': 'rgba(166, 226, 46, 0.3)',
  'diff-remove-bg': 'rgba(249, 38, 114, 0.1)',
  'diff-remove-border': 'rgba(249, 38, 114, 0.3)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#222218',
  'gutter-text': '#575848',
};

// --- Nord ---

const nord: ThemeColors = {
  'bg': '#2e3440',
  'bg-surface': '#3b4252',
  'bg-hover': '#434c5e',
  'bg-active': '#4c566a',
  'text': '#d8dee9',
  'text-dim': '#7b88a1',
  'text-bright': '#eceff4',
  'accent': '#88c0d0',
  'accent-hover': '#81a1c1',
  'green': '#a3be8c',
  'red': '#bf616a',
  'yellow': '#ebcb8b',
  'orange': '#d08770',
  'blue': '#81a1c1',
  'purple': '#b48ead',
  'teal': '#8fbcbb',
  'border': '#4c566a',
  'diff-add-bg': 'rgba(163, 190, 140, 0.1)',
  'diff-add-border': 'rgba(163, 190, 140, 0.3)',
  'diff-remove-bg': 'rgba(191, 97, 106, 0.1)',
  'diff-remove-border': 'rgba(191, 97, 106, 0.3)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#2a303c',
  'gutter-text': '#5b6578',
};

// --- Gruvbox Dark ---

const gruvboxDark: ThemeColors = {
  'bg': '#282828',
  'bg-surface': '#3c3836',
  'bg-hover': '#504945',
  'bg-active': '#665c54',
  'text': '#ebdbb2',
  'text-dim': '#928374',
  'text-bright': '#fbf1c7',
  'accent': '#83a598',
  'accent-hover': '#76988b',
  'green': '#b8bb26',
  'red': '#fb4934',
  'yellow': '#fabd2f',
  'orange': '#fe8019',
  'blue': '#83a598',
  'purple': '#d3869b',
  'teal': '#8ec07c',
  'border': '#504945',
  'diff-add-bg': 'rgba(184, 187, 38, 0.1)',
  'diff-add-border': 'rgba(184, 187, 38, 0.3)',
  'diff-remove-bg': 'rgba(251, 73, 52, 0.1)',
  'diff-remove-border': 'rgba(251, 73, 52, 0.3)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#232323',
  'gutter-text': '#665c54',
};

// --- Gruvbox Light ---

const gruvboxLight: ThemeColors = {
  'bg': '#fbf1c7',
  'bg-surface': '#f2e5bc',
  'bg-hover': '#ebdbb2',
  'bg-active': '#d5c4a1',
  'text': '#3c3836',
  'text-dim': '#7c6f64',
  'text-bright': '#282828',
  'accent': '#427b58',
  'accent-hover': '#376b4c',
  'green': '#79740e',
  'red': '#9d0006',
  'yellow': '#b57614',
  'orange': '#af3a03',
  'blue': '#076678',
  'purple': '#8f3f71',
  'teal': '#427b58',
  'border': '#d5c4a1',
  'diff-add-bg': 'rgba(121, 116, 14, 0.1)',
  'diff-add-border': 'rgba(121, 116, 14, 0.25)',
  'diff-remove-bg': 'rgba(157, 0, 6, 0.1)',
  'diff-remove-border': 'rgba(157, 0, 6, 0.25)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#f2e5bc',
  'gutter-text': '#928374',
};

// --- GitHub Dark ---

const githubDark: ThemeColors = {
  'bg': '#0d1117',
  'bg-surface': '#161b22',
  'bg-hover': '#1c2128',
  'bg-active': '#262c36',
  'text': '#c9d1d9',
  'text-dim': '#8b949e',
  'text-bright': '#f0f6fc',
  'accent': '#58a6ff',
  'accent-hover': '#4090e0',
  'green': '#3fb950',
  'red': '#f85149',
  'yellow': '#d29922',
  'orange': '#db6d28',
  'blue': '#58a6ff',
  'purple': '#bc8cff',
  'teal': '#39d353',
  'border': '#30363d',
  'diff-add-bg': 'rgba(63, 185, 80, 0.1)',
  'diff-add-border': 'rgba(63, 185, 80, 0.3)',
  'diff-remove-bg': 'rgba(248, 81, 73, 0.1)',
  'diff-remove-border': 'rgba(248, 81, 73, 0.3)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#0a0e14',
  'gutter-text': '#484f58',
};

// --- Rosé Pine ---

const rosePine: ThemeColors = {
  'bg': '#191724',
  'bg-surface': '#1f1d2e',
  'bg-hover': '#26233a',
  'bg-active': '#2a2740',
  'text': '#e0def4',
  'text-dim': '#6e6a86',
  'text-bright': '#f0efff',
  'accent': '#c4a7e7',
  'accent-hover': '#b498d7',
  'green': '#31748f',
  'red': '#eb6f92',
  'yellow': '#f6c177',
  'orange': '#ea9a97',
  'blue': '#9ccfd8',
  'purple': '#c4a7e7',
  'teal': '#9ccfd8',
  'border': '#2a2740',
  'diff-add-bg': 'rgba(49, 116, 143, 0.12)',
  'diff-add-border': 'rgba(49, 116, 143, 0.3)',
  'diff-remove-bg': 'rgba(235, 111, 146, 0.12)',
  'diff-remove-border': 'rgba(235, 111, 146, 0.3)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#16141f',
  'gutter-text': '#524f67',
};

// --- Ayu Dark ---

const ayuDark: ThemeColors = {
  'bg': '#0b0e14',
  'bg-surface': '#0f131a',
  'bg-hover': '#151a23',
  'bg-active': '#1c222d',
  'text': '#bfbdb6',
  'text-dim': '#636a76',
  'text-bright': '#e6e1cf',
  'accent': '#e6b450',
  'accent-hover': '#d9a740',
  'green': '#7fd962',
  'red': '#d95757',
  'yellow': '#e6b450',
  'orange': '#ff8f40',
  'blue': '#59c2ff',
  'purple': '#d2a6ff',
  'teal': '#95e6cb',
  'border': '#1c222d',
  'diff-add-bg': 'rgba(127, 217, 98, 0.1)',
  'diff-add-border': 'rgba(127, 217, 98, 0.3)',
  'diff-remove-bg': 'rgba(217, 87, 87, 0.1)',
  'diff-remove-border': 'rgba(217, 87, 87, 0.3)',
  'diff-context-bg': 'transparent',
  'gutter-bg': '#080a10',
  'gutter-text': '#3d424d',
};

export const BUILT_IN_THEMES: BuiltInTheme[] = [
  { id: 'dark', name: 'Dark', builtIn: true, colors: dark },
  { id: 'light', name: 'Light', builtIn: true, colors: light },
  { id: 'high-contrast-dark', name: 'High Contrast Dark', builtIn: true, colors: highContrastDark },
  { id: 'high-contrast-light', name: 'High Contrast Light', builtIn: true, colors: highContrastLight },
  { id: 'dracula', name: 'Dracula', builtIn: true, colors: dracula },
  { id: 'tokyo-night', name: 'Tokyo Night', builtIn: true, colors: tokyoNight },
  { id: 'one-dark-pro', name: 'One Dark Pro', builtIn: true, colors: oneDarkPro },
  { id: 'solarized-dark', name: 'Solarized Dark', builtIn: true, colors: solarizedDark },
  { id: 'solarized-light', name: 'Solarized Light', builtIn: true, colors: solarizedLight },
  { id: 'monokai', name: 'Monokai', builtIn: true, colors: monokai },
  { id: 'nord', name: 'Nord', builtIn: true, colors: nord },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark', builtIn: true, colors: gruvboxDark },
  { id: 'gruvbox-light', name: 'Gruvbox Light', builtIn: true, colors: gruvboxLight },
  { id: 'github-dark', name: 'GitHub Dark', builtIn: true, colors: githubDark },
  { id: 'rose-pine', name: 'Rosé Pine', builtIn: true, colors: rosePine },
  { id: 'ayu-dark', name: 'Ayu Dark', builtIn: true, colors: ayuDark },
];

export const DEFAULT_THEME_ID = 'dark';

/** Get a built-in theme by ID. */
export function getBuiltInTheme(id: string): BuiltInTheme | undefined {
  return BUILT_IN_THEMES.find(t => t.id === id);
}

/** Generate inline CSS setting all theme variables. Used for server-side injection. */
export function themeToInlineStyle(colors: ThemeColors): string {
  return THEME_VARIABLES.map(v => `--${v}:${colors[v]}`).join(';');
}
