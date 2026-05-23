import { Hono } from 'hono';

import {
  CreateThemeReqSchema,
  EditThemeBodySchema,
  SetActiveThemeReqSchema,
  UpdateThemeBodySchema,
} from '../api/index.js';
import type { CustomTheme } from '../themes/built-in.js';
import { BUILT_IN_THEMES, getBuiltInTheme } from '../themes/built-in.js';
import {
  deleteCustomTheme, generateThemeId, getActiveThemeColors, getActiveThemeId,
  getAllThemes, resolveTheme, saveCustomTheme, setActiveThemeId,
} from '../themes/config.js';
import type { AppEnv } from '../types.js';
import { parseBody } from '../utils/parseBody.js';

export const themeApiRoutes = new Hono<AppEnv>();

/** GET /themes — list all available themes with metadata */
themeApiRoutes.get('/', (c) => {
  const themes = getAllThemes();
  const activeId = getActiveThemeId();
  return c.json({
    themes: themes.map(t => ({
      id: t.id,
      name: t.name,
      builtIn: t.builtIn,
      ...(t.builtIn ? {} : { baseTheme: t.baseTheme }),
      colors: t.colors,
    })),
    activeId,
  });
});

/** GET /themes/active — get active theme ID and resolved colors */
themeApiRoutes.get('/active', (c) => {
  const id = getActiveThemeId();
  const colors = getActiveThemeColors();
  return c.json({ id, colors });
});

/** POST /themes/active — set the active theme */
themeApiRoutes.post('/active', async (c) => {
  const parsed = await parseBody(c, SetActiveThemeReqSchema);
  if (!parsed.ok) return parsed.response;

  const theme = resolveTheme(parsed.data.id);
  if (!theme) return c.json({ error: 'Theme not found' }, 404);

  setActiveThemeId(parsed.data.id);
  return c.json({ id: parsed.data.id, colors: theme.colors });
});

/** POST /themes — create a new custom theme (duplicate an existing one) */
themeApiRoutes.post('/', async (c) => {
  const parsed = await parseBody(c, CreateThemeReqSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const source = resolveTheme(body.sourceId);
  if (!source) return c.json({ error: 'Source theme not found' }, 404);

  const baseTheme = source.builtIn ? source.id : source.baseTheme;
  const name = body.name ?? `${source.name} (Copy)`;

  const newTheme: CustomTheme = {
    id: generateThemeId(),
    name,
    builtIn: false,
    baseTheme,
    colors: { ...source.colors },
  };

  saveCustomTheme(newTheme);
  return c.json(newTheme, 201);
});

/** POST /themes/:id/edit — edit a theme; auto-copies built-in themes */
themeApiRoutes.post('/:id/edit', async (c) => {
  const id = c.req.param('id');
  const parsed = await parseBody(c, EditThemeBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

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
    return c.json({ theme: newTheme, copied: true }, 201);
  }

  // Custom theme: edit in place
  const updated: CustomTheme = {
    ...source,
    name: body.name ?? source.name,
    colors: body.colors ? { ...source.colors, ...body.colors } : source.colors,
  };
  saveCustomTheme(updated);
  return c.json({ theme: updated, copied: false });
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

  const parsed = await parseBody(c, UpdateThemeBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const updated: CustomTheme = {
    ...existing,
    name: body.name ?? existing.name,
    colors: body.colors ? { ...existing.colors, ...body.colors } : existing.colors,
  };

  saveCustomTheme(updated);
  return c.json(updated);
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

  return c.json({ ok: true } as const);
});
