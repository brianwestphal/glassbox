/**
 * Typed API for the content-plugin management UI (doc 29, GB-1040): list
 * installed plugins with their state, toggle enablement (global / per-project),
 * install from a directory, and uninstall.
 */
import { z } from 'zod';

import { apiCall } from './_runner.js';

export const PluginStatusSchema = z.enum(['loaded', 'disabled', 'error']);
export type PluginStatus = z.infer<typeof PluginStatusSchema>;

/** A manifest-declared preference (doc 29 FR-29.12). Mirrors `PluginPreference`. */
export const PluginPreferenceInfoSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'select']),
  default: z.string().optional(),
  description: z.string().optional(),
  options: z.array(z.string()).optional(),
  scope: z.enum(['global', 'project']).optional(),
  secret: z.boolean().optional(),
});
export type PluginPreferenceInfo = z.infer<typeof PluginPreferenceInfoSchema>;

export const PluginInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  /** Extensions the plugin's content types declare (informational). */
  extensions: z.array(z.string()),
  status: PluginStatusSchema,
  error: z.string().optional(),
  /** True when active (loaded). False when disabled by either scope. */
  enabled: z.boolean(),
  /** Which scope disables it (global wins), when disabled. */
  disabledScope: z.enum(['global', 'project']).optional(),
  /** The two independent disable flags, so the UI can render both toggles. */
  globalDisabled: z.boolean(),
  projectDisabled: z.boolean(),
  /** Manifest-declared preferences + their current values (doc 29 FR-29.12).
   *  Secret values are never sent; `secretConfigured` names the secret keys that
   *  have a stored value (GB-1054). */
  preferences: z.array(PluginPreferenceInfoSchema),
  preferenceValues: z.record(z.string(), z.string()),
  secretConfigured: z.array(z.string()),
});
export type PluginInfo = z.infer<typeof PluginInfoSchema>;

export const ListPluginsRespSchema = z.object({
  plugins: z.array(PluginInfoSchema),
  /** Set when a mutation (e.g. install-from-disk of a non-plugin folder) failed;
   *  the list is still returned so the UI stays in sync + can show the message. */
  error: z.string().optional(),
});
export type ListPluginsResp = z.infer<typeof ListPluginsRespSchema>;

export const SetPluginDisabledReqSchema = z.object({
  scope: z.enum(['global', 'project']),
  disabled: z.boolean(),
});
export type SetPluginDisabledReq = z.infer<typeof SetPluginDisabledReqSchema>;

export const InstallPluginReqSchema = z.object({ path: z.string().min(1) });
export type InstallPluginReq = z.infer<typeof InstallPluginReqSchema>;

export const SetPluginPreferenceReqSchema = z.object({ key: z.string().min(1), value: z.string() });
export type SetPluginPreferenceReq = z.infer<typeof SetPluginPreferenceReqSchema>;

/** Every mutating call returns the refreshed list (after a reload). */
export async function listPlugins(): Promise<ListPluginsResp> {
  return apiCall(ListPluginsRespSchema, '/plugins');
}

export async function setPluginDisabled(id: string, req: SetPluginDisabledReq): Promise<ListPluginsResp> {
  return apiCall(ListPluginsRespSchema, `/plugins/${encodeURIComponent(id)}/disabled`, { method: 'POST', body: req });
}

export async function installPlugin(req: InstallPluginReq): Promise<ListPluginsResp> {
  return apiCall(ListPluginsRespSchema, '/plugins/install', { method: 'POST', body: req });
}

export async function uninstallPlugin(id: string): Promise<ListPluginsResp> {
  return apiCall(ListPluginsRespSchema, `/plugins/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function setPluginPreference(id: string, req: SetPluginPreferenceReq): Promise<ListPluginsResp> {
  return apiCall(ListPluginsRespSchema, `/plugins/${encodeURIComponent(id)}/preferences`, { method: 'POST', body: req });
}
