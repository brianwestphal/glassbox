import { Hono } from 'hono';

import type { ActiveThemeResp, CreateThemeReq, CreateThemeResp, EditThemeReq, EditThemeResp, ListThemesResp, SetActiveThemeReq, SetActiveThemeResp, UpdateThemeReq, UpdateThemeResp } from '../api/index.js';
import type { CustomTheme } from '../themes/built-in.js';
import { BUILT_IN_THEMES, getBuiltInTheme, THEME_VARIABLES } from '../themes/built-in.js';
import {
  deleteCustomTheme, generateThemeId, getActiveThemeColors, getActiveThemeId,
  getAllThemes, resolveTheme, saveCustomTheme, setActiveThemeId,
} from '../themes/config.js';
import type { AppEnv } from '../types.js';
import { isNonEmptyString } from '../utils/validate.js';

export const themeApiRoutes = new Hono<AppEnv>();

/** Validate that a colors object only contains known theme keys with string values. */
function validateColors(colors: unknown): string | null {
  if (typeof colors !== 'object' || colors === null || Array.isArray(colors)) {
    return 'colors must be an object';
  }
  const validKeys = new Set<string>(THEME_VARIABLES);
  for (const [key, value] of Object.entries(colors)) {
    if (!validKeys.has(key)) {
      return `colors contains unknown key: ${key}`;
    }
    if (typeof value !== 'string') {
      return `colors.${key} must be a string`;
    }
  }
  return null;
}

/** GET /themes — list all available themes with metadata */
themeApiRoutes.get('/', (c) => {
  const themes = getAllThemes();
  const activeId = getActiveThemeId();
  return c.json<ListThemesResp>({
    themes: themes.map(t => ({
      id: t.id,
      name: t.name,
      builtIn: t.builtIn,
      ...(t.builtIn ? {} : { baseTheme: (t as { baseTheme?: string }).baseTheme }),
      colors: t.colors,
    })),
    activeId,
  });
});

/** GET /themes/active — get active theme ID and resolved colors */
themeApiRoutes.get('/active', (c) => {
  const id = getActiveThemeId();
  const colors = getActiveThemeColors();
  return c.json<ActiveThemeResp>({ id, colors });
});

/** POST /themes/active — set the active theme */
themeApiRoutes.post('/active', async (c) => {
  const body = await c.req.json<SetActiveThemeReq>();
  if (!isNonEmptyString(body.id)) return c.json({ error: 'id must be a non-empty string' }, 400);

  const theme = resolveTheme(body.id);
  if (!theme) return c.json({ error: 'Theme not found' }, 404);

  setActiveThemeId(body.id);
  return c.json<SetActiveThemeResp>({ id: body.id, colors: theme.colors });
});

/** POST /themes — create a new custom theme (duplicate an existing one) */
themeApiRoutes.post('/', async (c) => {
  const body = await c.req.json<CreateThemeReq>();
  if (!isNonEmptyString(body.sourceId)) return c.json({ error: 'sourceId must be a non-empty string' }, 400);
  if (body.name !== undefined && !isNonEmptyString(body.name)) {
    return c.json({ error: 'name must be a non-empty string when provided' }, 400);
  }

  const source = resolveTheme(body.sourceId);
  if (!source) return c.json({ error: 'Source theme not found' }, 404);

  const baseTheme = source.builtIn ? source.id : (source).baseTheme;
  const name = body.name ?? `${source.name} (Copy)`;

  const newTheme: CustomTheme = {
    id: generateThemeId(),
    name,
    builtIn: false,
    baseTheme,
    colors: { ...source.colors },
  };

  saveCustomTheme(newTheme);
  return c.json<CreateThemeResp>(newTheme, 201);
});

/** POST /themes/:id/edit — edit a theme; auto-copies built-in themes */
themeApiRoutes.post('/:id/edit', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Omit<EditThemeReq, 'id'>>();

  if (body.name !== undefined && !isNonEmptyString(body.name)) {
    return c.json({ error: 'name must be a non-empty string when provided' }, 400);
  }
  if (body.colors !== undefined) {
    const colorsError = validateColors(body.colors);
    if (colorsError !== null) return c.json({ error: colorsError }, 400);
  }

  const source = resolveTheme(id);
  if (!source) return c.json({ error: 'Theme not found' }, 404);

  if (source.builtIn) {
    // Auto-copy: create a "(Customized)" copy and apply the edit to it
    const newTheme: CustomTheme = {
      id: generateThemeId(),
      name: `${source.name} (Customized)`,
      builtIn: false,
      baseTheme: source.id,
      colors: body.colors ? { ...source.colors, ...body.colors } : { ...source.colors },
    };
    if (body.name !== undefined && body.name !== '') newTheme.name = body.name;
    saveCustomTheme(newTheme);
    setActiveThemeId(newTheme.id);
    return c.json<EditThemeResp>({ theme: newTheme, copied: true }, 201);
  }

  // Custom theme: edit in place
  const updated: CustomTheme = {
    ...source,
    name: body.name ?? source.name,
    colors: body.colors ? { ...source.colors, ...body.colors } : source.colors,
  };
  saveCustomTheme(updated);
  return c.json<EditThemeResp>({ theme: updated, copied: false });
});

/** PATCH /themes/:id — update a custom theme (rename, edit colors) */
themeApiRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');

  // Built-in themes can't be directly edited
  if (getBuiltInTheme(id)) {
    return c.json({ error: 'Cannot edit built-in theme' }, 400);
  }

  const existing = resolveTheme(id);
  if (!existing || existing.builtIn) {
    return c.json({ error: 'Theme not found' }, 404);
  }

  const body = await c.req.json<Omit<UpdateThemeReq, 'id'>>();

  if (body.name !== undefined && !isNonEmptyString(body.name)) {
    return c.json({ error: 'name must be a non-empty string when provided' }, 400);
  }
  if (body.colors !== undefined) {
    const colorsError = validateColors(body.colors);
    if (colorsError !== null) return c.json({ error: colorsError }, 400);
  }

  const updated: CustomTheme = {
    ...existing,
    name: body.name ?? existing.name,
    colors: body.colors ? { ...existing.colors, ...body.colors } : existing.colors,
  };

  saveCustomTheme(updated);
  return c.json<UpdateThemeResp>(updated);
});

/** DELETE /themes/:id — delete a custom theme */
themeApiRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');

  if (getBuiltInTheme(id)) {
    return c.json({ error: 'Cannot delete built-in theme' }, 400);
  }

  deleteCustomTheme(id);

  // If the active theme was deleted, fall back to default
  if (getActiveThemeId() === id) {
    setActiveThemeId(BUILT_IN_THEMES[0].id);
  }

  return c.json({ ok: true });
});
