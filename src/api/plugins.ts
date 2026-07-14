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

/** A config-layout label tone (doc 29 FR-29.18). Mirrors `ConfigLabelColor`. */
export const ConfigLabelColorSchema = z.enum(['default', 'success', 'error', 'warning', 'transient']);
export type ConfigLabelColor = z.infer<typeof ConfigLabelColorSchema>;

/** One config-layout node (doc 29 FR-29.18). Recursive (`group` nests), so the
 *  interface is declared explicitly and the schema is `z.lazy`-wrapped. */
export interface ConfigLayoutItem {
  type: 'preference' | 'divider' | 'spacer' | 'label' | 'button' | 'group';
  key?: string;
  id?: string;
  text?: string;
  color?: ConfigLabelColor;
  label?: string;
  action?: string;
  style?: string;
  title?: string;
  collapsed?: boolean;
  items?: ConfigLayoutItem[];
}
export const ConfigLayoutItemSchema: z.ZodType<ConfigLayoutItem> = z.lazy(() =>
  z.object({
    type: z.enum(['preference', 'divider', 'spacer', 'label', 'button', 'group']),
    key: z.string().optional(),
    id: z.string().optional(),
    text: z.string().optional(),
    color: ConfigLabelColorSchema.optional(),
    label: z.string().optional(),
    action: z.string().optional(),
    style: z.string().optional(),
    title: z.string().optional(),
    collapsed: z.boolean().optional(),
    items: z.array(ConfigLayoutItemSchema).optional(),
  }),
);

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
  /** Optional manifest arrangement of the preferences (doc 29 FR-29.18). */
  configLayout: z.array(ConfigLayoutItemSchema).optional(),
  /** Effective `label`-item text/color, keyed by label id (doc 29 FR-29.18). */
  configLabels: z.record(z.string(), z.object({ text: z.string(), color: ConfigLabelColorSchema.optional() })),
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

/** A config-layout `button` action (doc 29 FR-29.18) or a UI-element action (doc 30).
 *  `value` carries a stateful control's new state (toggle/switch/segmented-control). */
export const RunPluginActionReqSchema = z.object({ actionId: z.string().min(1), value: z.string().optional() });
export type RunPluginActionReq = z.infer<typeof RunPluginActionReqSchema>;

/**
 * A plugin-registered UI element (doc 30 FR-30.3), flattened for the wire with
 * its `pluginId`. Deliberately permissive (every variant field optional, `type`/
 * `location` are plain strings) — the client renders the subset it supports.
 */
/** One face of a two-state control, or a config for a plain button (doc 30). */
const UIElementFaceSchema = z.object({
  label: z.string().optional(),
  icon: z.string().optional(),
  title: z.string().optional(),
  style: z.string().optional(),
});
/** A segment of a segmented-control (doc 30 FR-30.3). */
const UISegmentSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  icon: z.string().optional(),
  title: z.string().optional(),
});

export const PluginUIElementSchema = z.object({
  pluginId: z.string(),
  id: z.string(),
  type: z.string(),
  location: z.string(),
  label: z.string().optional(),
  icon: z.string().optional(),
  title: z.string().optional(),
  style: z.string().optional(),
  action: z.string().optional(),
  url: z.string().optional(),
  // Stateful controls (doc 30 FR-30.3): toggle/switch (`on`/`off`), segmented
  // (`segments`/`selectionMode`); `stateKey` persists, `value` is the resolved
  // current state the host attaches when listing.
  on: UIElementFaceSchema.optional(),
  off: UIElementFaceSchema.optional(),
  onLabel: z.string().optional(),
  offLabel: z.string().optional(),
  segments: z.array(UISegmentSchema).optional(),
  selectionMode: z.string().optional(),
  stateKey: z.string().optional(),
  value: z.string().optional(),
});
export type PluginUIElementInfo = z.infer<typeof PluginUIElementSchema>;

/** `GET /plugins/ui` → the registered UI elements of enabled plugins. */
export const ListPluginUiRespSchema = z.object({ elements: z.array(PluginUIElementSchema) });
export type ListPluginUiResp = z.infer<typeof ListPluginUiRespSchema>;

/** `POST /plugins/:id/action` → the refreshed list (for config-layout labels)
 *  plus the optional `result` a UI/config action returned (doc 30 FR-30.5). */
export const RunPluginActionRespSchema = ListPluginsRespSchema.extend({
  result: z.object({ message: z.string().optional() }).optional(),
});
export type RunPluginActionResp = z.infer<typeof RunPluginActionRespSchema>;

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

/** Run a config-layout button (doc 29 FR-29.18) or UI-element (doc 30) action;
 *  returns the refreshed list (so `updateConfigLabel` changes show) plus any
 *  `result` the action returned (e.g. a `message` toast). */
export async function runPluginAction(id: string, req: RunPluginActionReq): Promise<RunPluginActionResp> {
  return apiCall(RunPluginActionRespSchema, `/plugins/${encodeURIComponent(id)}/action`, { method: 'POST', body: req });
}

/** List the registered UI elements of enabled plugins (doc 30 FR-30.4). */
export async function listPluginUi(): Promise<PluginUIElementInfo[]> {
  return (await apiCall(ListPluginUiRespSchema, '/plugins/ui')).elements;
}
