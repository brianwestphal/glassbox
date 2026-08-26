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
import { isThemeWcagAA } from '../themes/contrast.js';
import type { AppEnv } from '../types.js';
import { errorResponse, parseBody, requireSlugParam } from '../utils/parseBody.js';

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
      wcagAA: isThemeWcagAA(t.colors),
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
  if (!theme) return errorResponse(c, 'Theme not found', 404);

  setActiveThemeId(parsed.data.id);
  return c.json({ id: parsed.data.id, colors: theme.colors });
});

/** POST /themes — create a new custom theme (duplicate an existing one) */
themeApiRoutes.post('/', async (c) => {
  const parsed = await parseBody(c, CreateThemeReqSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const source = resolveTheme(body.sourceId);
  if (!source) return errorResponse(c, 'Source theme not found', 404);

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

/** Apply a rename/recolor edit onto a theme — the shared merge used by both
 *  POST /:id/edit and PATCH /:id. */
function mergeThemeEdit(
  source: CustomTheme,
  body: { name?: string; colors?: Partial<CustomTheme['colors']> },
): CustomTheme {
  return {
    ...source,
    name: body.name !== undefined && body.name !== '' ? body.name : source.name,
    colors: body.colors ? { ...source.colors, ...body.colors } : source.colors,
  };
}

/** POST /themes/:id/edit — edit a theme; auto-copies built-in themes */
themeApiRoutes.post('/:id/edit', async (c) => {
  const idParam = requireSlugParam(c, 'id');
  if (!idParam.ok) return idParam.response;
  const id = idParam.data;
  const parsed = await parseBody(c, EditThemeBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const source = resolveTheme(id);
  if (!source) return errorResponse(c, 'Theme not found', 404);

  if (source.builtIn) {
    // Auto-copy: create a "(Customized)" copy and apply the edit to it
    const newTheme: CustomTheme = {
      ...mergeThemeEdit({ ...source, builtIn: false, baseTheme: source.id }, body),
      id: generateThemeId(),
      name: body.name !== undefined && body.name !== '' ? body.name : `${source.name} (Customized)`,
    };
    saveCustomTheme(newTheme);
    setActiveThemeId(newTheme.id);
    return c.json({ theme: newTheme, copied: true }, 201);
  }

  // Custom theme: edit in place
  const updated = mergeThemeEdit(source, body);
  saveCustomTheme(updated);
  return c.json({ theme: updated, copied: false });
});

/** PATCH /themes/:id — update a custom theme (rename, edit colors) */
themeApiRoutes.patch('/:id', async (c) => {
  const idParam = requireSlugParam(c, 'id');
  if (!idParam.ok) return idParam.response;
  const id = idParam.data;

  // Built-in themes can't be directly edited
  if (getBuiltInTheme(id)) {
    return errorResponse(c, 'Cannot edit built-in theme', 400);
  }

  const existing = resolveTheme(id);
  if (!existing || existing.builtIn) {
    return errorResponse(c, 'Theme not found', 404);
  }

  const parsed = await parseBody(c, UpdateThemeBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const updated = mergeThemeEdit(existing, body);
  saveCustomTheme(updated);
  return c.json(updated);
});

/** DELETE /themes/:id — delete a custom theme */
themeApiRoutes.delete('/:id', (c) => {
  const idParam = requireSlugParam(c, 'id');
  if (!idParam.ok) return idParam.response;
  const id = idParam.data;

  if (getBuiltInTheme(id)) {
    return errorResponse(c, 'Cannot delete built-in theme', 400);
  }

  deleteCustomTheme(id);

  // If the active theme was deleted, fall back to default
  if (getActiveThemeId() === id) {
    setActiveThemeId(BUILT_IN_THEMES[0].id);
  }

  return c.json({ ok: true } as const);
});
