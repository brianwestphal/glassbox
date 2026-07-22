/**
 * Theme configuration: persistence and custom theme file management.
 * Active theme is stored in ~/.glassbox/config.json.
 * Custom themes are stored in ~/.glassbox/themes/*.json.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

import { StoredCustomThemeSchema } from '../api/themes.js';
import { GLOBAL_CONFIG_DIR, readGlobalConfig, updateGlobalConfig } from '../global-config.js';
import type { CustomTheme, Theme, ThemeColors } from './built-in.js';
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, getBuiltInTheme } from './built-in.js';

const THEMES_DIR = join(GLOBAL_CONFIG_DIR, 'themes');

/** The `theme` slice of `~/.glassbox/config.json`, validated rather than
 *  asserted — a hand-edited `"theme": "dark"` (string, not object) previously
 *  threw a TypeError on the property write in `setActiveThemeId`. */
const ThemeConfigSliceSchema = z.object({ active: z.string().optional() }).loose();

/** Get the active theme ID from config. */
export function getActiveThemeId(): string {
  const config = readGlobalConfig();
  const parsed = ThemeConfigSliceSchema.safeParse(config.theme);
  return parsed.success ? (parsed.data.active ?? DEFAULT_THEME_ID) : DEFAULT_THEME_ID;
}

/** Set the active theme ID in config. */
export function setActiveThemeId(id: string): void {
  updateGlobalConfig((config) => {
    const parsed = ThemeConfigSliceSchema.safeParse(config.theme);
    // Replace a malformed slice wholesale instead of writing into it.
    config.theme = { ...(parsed.success ? parsed.data : {}), active: id };
  });
}

/** Read + validate one stored theme file, mapped to the `CustomTheme` shape —
 *  the shared body of `loadCustomThemes` and `getCustomTheme`. Returns
 *  undefined for missing / corrupt / schema-invalid files. */
function readStoredTheme(filePath: string): CustomTheme | undefined {
  try {
    const parsed = StoredCustomThemeSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf-8')));
    if (!parsed.success) return undefined;
    const d = parsed.data;
    // `d.colors` is validated as a string→string map above; the cast to the
    // exact `ThemeColors` shape is the post-validation tightening.
    return { id: d.id, name: d.name, colors: d.colors as unknown as ThemeColors, builtIn: false, baseTheme: d.baseTheme ?? '' };
  } catch {
    return undefined; // corrupt file (bad JSON) / unreadable
  }
}

/** Load all custom themes from ~/.glassbox/themes/. */
export function loadCustomThemes(): CustomTheme[] {
  if (!existsSync(THEMES_DIR)) return [];
  const themes: CustomTheme[] = [];
  try {
    for (const file of readdirSync(THEMES_DIR).filter(f => f.endsWith('.json'))) {
      const theme = readStoredTheme(join(THEMES_DIR, file));
      if (theme !== undefined) themes.push(theme);
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
  return readStoredTheme(filePath);
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
  const fallback = getBuiltInTheme(DEFAULT_THEME_ID);
  if (fallback === undefined) throw new Error(`Default theme '${DEFAULT_THEME_ID}' not found`);
  return fallback.colors;
}

/** Generate a unique ID for a new custom theme. */
export function generateThemeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
