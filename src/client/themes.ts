/**
 * Client-side theme application. Applies theme colors by setting CSS custom
 * properties on document.documentElement.
 */
import { api } from './api.js';

interface ThemeColors {
  [key: string]: string;
}

interface ActiveThemeResponse {
  id: string;
  colors: ThemeColors;
}

/** Apply theme colors to the document root. */
export function applyThemeColors(colors: ThemeColors): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--${key}`, value);
  }
}

/** Switch to a theme by ID. Persists via API and applies colors immediately. */
export async function switchTheme(id: string): Promise<void> {
  const result = await api<ActiveThemeResponse>('/themes/active', {
    method: 'POST',
    body: { id },
  });
  applyThemeColors(result.colors);
  document.documentElement.setAttribute('data-theme', id);
}
