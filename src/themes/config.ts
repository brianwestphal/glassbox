/**
 * Theme configuration: persistence and custom theme file management.
 * Active theme is stored in ~/.glassbox/config.json.
 * Custom themes are stored in ~/.glassbox/themes/*.json.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { CustomTheme, Theme, ThemeColors } from './built-in.js';
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, getBuiltInTheme } from './built-in.js';

const CONFIG_DIR = join(homedir(), '.glassbox');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const THEMES_DIR = join(CONFIG_DIR, 'themes');

function readConfigFile(): Record<string, unknown> {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    }
  } catch { /* corrupt config */ }
  return {};
}

function writeConfigFile(config: Record<string, unknown>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/** Get the active theme ID from config. */
export function getActiveThemeId(): string {
  const config = readConfigFile();
  const theme = config.theme as Record<string, unknown> | undefined;
  return (theme?.active as string) ?? DEFAULT_THEME_ID;
}

/** Set the active theme ID in config. */
export function setActiveThemeId(id: string): void {
  const config = readConfigFile();
  if (config.theme === undefined) config.theme = {};
  (config.theme as Record<string, unknown>).active = id;
  writeConfigFile(config);
}

/** Load all custom themes from ~/.glassbox/themes/. */
export function loadCustomThemes(): CustomTheme[] {
  if (!existsSync(THEMES_DIR)) return [];
  const themes: CustomTheme[] = [];
  try {
    const files = readdirSync(THEMES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(THEMES_DIR, file), 'utf-8')) as CustomTheme;
        if (data.id && data.name && data.colors) {
          themes.push({ ...data, builtIn: false });
        }
      } catch { /* skip corrupt theme files */ }
    }
  } catch { /* themes dir unreadable */ }
  return themes;
}

/** Save a custom theme to disk. */
export function saveCustomTheme(theme: CustomTheme): void {
  mkdirSync(THEMES_DIR, { recursive: true });
  const filePath = join(THEMES_DIR, `${theme.id}.json`);
  writeFileSync(filePath, JSON.stringify(theme, null, 2), 'utf-8');
}

/** Delete a custom theme from disk. */
export function deleteCustomTheme(id: string): void {
  const filePath = join(THEMES_DIR, `${id}.json`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

/** Get a single custom theme by ID. */
export function getCustomTheme(id: string): CustomTheme | undefined {
  const filePath = join(THEMES_DIR, `${id}.json`);
  if (!existsSync(filePath)) return undefined;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as CustomTheme;
    return { ...data, builtIn: false };
  } catch {
    return undefined;
  }
}

/** Get all themes (built-in + custom). */
export function getAllThemes(): Theme[] {
  return [...BUILT_IN_THEMES, ...loadCustomThemes()];
}

/** Resolve a theme by ID (built-in or custom). */
export function resolveTheme(id: string): Theme | undefined {
  return getBuiltInTheme(id) ?? getCustomTheme(id);
}

/** Get the resolved colors for the active theme. */
export function getActiveThemeColors(): ThemeColors {
  const id = getActiveThemeId();
  const theme = resolveTheme(id);
  if (theme) return theme.colors;
  // Fallback to dark if active theme is missing
  return getBuiltInTheme(DEFAULT_THEME_ID)!.colors;
}

/** Generate a unique ID for a new custom theme. */
export function generateThemeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
