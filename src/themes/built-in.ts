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
  'text-dim': '#8888aa',
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

export const BUILT_IN_THEMES: BuiltInTheme[] = [
  { id: 'dark', name: 'Dark', builtIn: true, colors: dark },
  { id: 'light', name: 'Light', builtIn: true, colors: light },
  { id: 'high-contrast-dark', name: 'High Contrast Dark', builtIn: true, colors: highContrastDark },
  { id: 'high-contrast-light', name: 'High Contrast Light', builtIn: true, colors: highContrastLight },
  { id: 'dracula', name: 'Dracula', builtIn: true, colors: dracula },
  { id: 'tokyo-night', name: 'Tokyo Night', builtIn: true, colors: tokyoNight },
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
