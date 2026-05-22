/**
 * Client-side theme application. Applies theme colors by setting CSS custom
 * properties on document.documentElement.
 */
import { setActiveTheme } from '../api/index.js';

/** Apply theme colors to the document root. Accepts either the typed
 *  `ThemeColors` shape from `src/themes/built-in.ts` or a plain string map
 *  (live-editor scratch state) — both are walked the same way. */
export function applyThemeColors(colors: object): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === 'string') {
      root.style.setProperty(`--${key}`, value);
    }
  }
}

/** Switch to a theme by ID. Persists via API and applies colors immediately. */
export async function switchTheme(id: string): Promise<void> {
  const result = await setActiveTheme({ id });
  applyThemeColors(result.colors);
  document.documentElement.setAttribute('data-theme', id);
}
