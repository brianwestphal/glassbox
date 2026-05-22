/**
 * Typed API for `/themes` endpoints — listing, active theme, custom theme
 * CRUD, and the auto-copy-on-edit flow for built-in themes.
 */
import type { ThemeColors } from '../themes/built-in.js';
import { api } from './_runner.js';

export interface ThemeSummary {
  id: string;
  name: string;
  builtIn: boolean;
  baseTheme?: string;
  colors: ThemeColors;
}

export interface ListThemesResp {
  themes: ThemeSummary[];
  activeId: string;
}

export interface ActiveThemeResp {
  id: string;
  colors: ThemeColors;
}

export interface SetActiveThemeReq { id: string }
export type SetActiveThemeResp = ActiveThemeResp;

export interface CreateThemeReq {
  sourceId: string;
  name?: string;
}
export interface CreateThemeResp {
  id: string;
  name: string;
  builtIn: false;
  baseTheme: string;
  colors: ThemeColors;
}

export interface EditThemeReq {
  id: string;
  colors?: Partial<ThemeColors>;
  name?: string;
}
export interface EditThemeResp {
  theme: CreateThemeResp;
  copied: boolean;
}

export interface UpdateThemeReq {
  id: string;
  colors?: Partial<ThemeColors>;
  name?: string;
}
export type UpdateThemeResp = CreateThemeResp;

export interface DeleteThemeReq { id: string }
export interface DeleteThemeResp { ok: true }

// --- Callers ---
// `/api/themes` mounts at the bare `/themes` prefix server-side, but the
// router itself uses `/` and `/:id`. From the client side we always go
// through `/themes` here.

export async function listThemes(): Promise<ListThemesResp> {
  return api<ListThemesResp>('/themes');
}

export async function getActiveTheme(): Promise<ActiveThemeResp> {
  return api<ActiveThemeResp>('/themes/active');
}

export async function setActiveTheme(req: SetActiveThemeReq): Promise<SetActiveThemeResp> {
  return api<SetActiveThemeResp>('/themes/active', { method: 'POST', body: req });
}

export async function createTheme(req: CreateThemeReq): Promise<CreateThemeResp> {
  return api<CreateThemeResp>('/themes', { method: 'POST', body: req });
}

export async function editTheme(req: EditThemeReq): Promise<EditThemeResp> {
  const { id, ...body } = req;
  return api<EditThemeResp>(`/themes/${id}/edit`, { method: 'POST', body });
}

export async function updateTheme(req: UpdateThemeReq): Promise<UpdateThemeResp> {
  const { id, ...body } = req;
  return api<UpdateThemeResp>(`/themes/${id}`, { method: 'PATCH', body });
}

export async function deleteTheme(req: DeleteThemeReq): Promise<DeleteThemeResp> {
  return api<DeleteThemeResp>(`/themes/${req.id}`, { method: 'DELETE' });
}
