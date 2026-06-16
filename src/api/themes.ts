/**
 * Typed API for `/themes` endpoints — listing, active theme, custom theme
 * CRUD, and the auto-copy-on-edit flow for built-in themes.
 */
import { z } from 'zod';

import type { ThemeColors } from '../themes/built-in.js';
import { THEME_VARIABLES } from '../themes/built-in.js';
import { apiCall } from './_runner.js';

/** Build a zod schema that requires every known `THEME_VARIABLES` key as
 *  a string. Lazy-initialized so the SCSS-derived list stays the SSOT.
 *  The cast through `unknown` is because zod can't statically prove the
 *  built shape covers every `ThemeColors` field — `THEME_VARIABLES` is
 *  the runtime source of truth for that, and a missing/extra key there
 *  is what would actually cause drift. */
function buildThemeColorsSchema(): z.ZodType<ThemeColors> {
  const shape: Record<string, z.ZodString> = {};
  for (const key of THEME_VARIABLES) shape[key] = z.string();
  return z.object(shape) as unknown as z.ZodType<ThemeColors>;
}
export const ThemeColorsSchema = buildThemeColorsSchema();

/** Partial colors patch — accepts any subset of theme keys. Used by
 *  `EditTheme`/`UpdateTheme` which apply incremental color edits. */
function buildPartialThemeColorsSchema(): z.ZodType<Partial<ThemeColors>> {
  const shape: Record<string, z.ZodOptional<z.ZodString>> = {};
  for (const key of THEME_VARIABLES) shape[key] = z.string().optional();
  return z.object(shape).partial();
}
export const PartialThemeColorsSchema = buildPartialThemeColorsSchema();

/** A custom theme as stored on disk in `~/.glassbox/themes/*.json`. Validated
 *  at the read boundary (see `loadCustomThemes` / `getCustomTheme`) instead of
 *  blindly cast. `colors` is checked as a string→string map rather than the
 *  strict `ThemeColorsSchema` on purpose: adding a new theme variable later
 *  must not invalidate (and silently drop) a user's existing custom themes —
 *  any missing key just falls back to the `:root` default at apply time. */
export const StoredCustomThemeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseTheme: z.string().optional(),
  colors: z.record(z.string(), z.string()),
});
export type StoredCustomTheme = z.infer<typeof StoredCustomThemeSchema>;

export const ThemeSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  builtIn: z.boolean(),
  baseTheme: z.string().optional(),
  colors: ThemeColorsSchema,
});
export type ThemeSummary = z.infer<typeof ThemeSummarySchema>;

export const ListThemesRespSchema = z.object({
  themes: z.array(ThemeSummarySchema),
  activeId: z.string(),
});
export type ListThemesResp = z.infer<typeof ListThemesRespSchema>;

export const ActiveThemeRespSchema = z.object({
  id: z.string(),
  colors: ThemeColorsSchema,
});
export type ActiveThemeResp = z.infer<typeof ActiveThemeRespSchema>;

export const SetActiveThemeReqSchema = z.object({ id: z.string().min(1) });
export type SetActiveThemeReq = z.infer<typeof SetActiveThemeReqSchema>;
export const SetActiveThemeRespSchema = ActiveThemeRespSchema;
export type SetActiveThemeResp = z.infer<typeof SetActiveThemeRespSchema>;

export const CreateThemeReqSchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type CreateThemeReq = z.infer<typeof CreateThemeReqSchema>;
export const CreateThemeRespSchema = z.object({
  id: z.string(),
  name: z.string(),
  builtIn: z.literal(false),
  baseTheme: z.string(),
  colors: ThemeColorsSchema,
});
export type CreateThemeResp = z.infer<typeof CreateThemeRespSchema>;

export const EditThemeReqSchema = z.object({
  id: z.string(),
  colors: PartialThemeColorsSchema.optional(),
  name: z.string().min(1).optional(),
});
export type EditThemeReq = z.infer<typeof EditThemeReqSchema>;
export const EditThemeBodySchema = EditThemeReqSchema.omit({ id: true });

export const EditThemeRespSchema = z.object({
  theme: CreateThemeRespSchema,
  copied: z.boolean(),
});
export type EditThemeResp = z.infer<typeof EditThemeRespSchema>;

export const UpdateThemeReqSchema = z.object({
  id: z.string(),
  colors: PartialThemeColorsSchema.optional(),
  name: z.string().min(1).optional(),
});
export type UpdateThemeReq = z.infer<typeof UpdateThemeReqSchema>;
export const UpdateThemeBodySchema = UpdateThemeReqSchema.omit({ id: true });

export const UpdateThemeRespSchema = CreateThemeRespSchema;
export type UpdateThemeResp = z.infer<typeof UpdateThemeRespSchema>;

export const DeleteThemeReqSchema = z.object({ id: z.string() });
export type DeleteThemeReq = z.infer<typeof DeleteThemeReqSchema>;
export const DeleteThemeRespSchema = z.object({ ok: z.literal(true) });
export type DeleteThemeResp = z.infer<typeof DeleteThemeRespSchema>;

// --- Callers ---

export async function listThemes(): Promise<ListThemesResp> {
  return apiCall(ListThemesRespSchema, '/themes');
}

export async function getActiveTheme(): Promise<ActiveThemeResp> {
  return apiCall(ActiveThemeRespSchema, '/themes/active');
}

export async function setActiveTheme(req: SetActiveThemeReq): Promise<SetActiveThemeResp> {
  return apiCall(SetActiveThemeRespSchema, '/themes/active', { method: 'POST', body: req });
}

export async function createTheme(req: CreateThemeReq): Promise<CreateThemeResp> {
  return apiCall(CreateThemeRespSchema, '/themes', { method: 'POST', body: req });
}

export async function editTheme(req: EditThemeReq): Promise<EditThemeResp> {
  const { id, ...body } = req;
  return apiCall(EditThemeRespSchema, `/themes/${id}/edit`, { method: 'POST', body });
}

export async function updateTheme(req: UpdateThemeReq): Promise<UpdateThemeResp> {
  const { id, ...body } = req;
  return apiCall(UpdateThemeRespSchema, `/themes/${id}`, { method: 'PATCH', body });
}

export async function deleteTheme(req: DeleteThemeReq): Promise<DeleteThemeResp> {
  return apiCall(DeleteThemeRespSchema, `/themes/${req.id}`, { method: 'DELETE' });
}
