/**
 * Per-project + global plugin enablement (doc 29 FR-29.16). An installed plugin
 * is **enabled by default**; it becomes inactive only when disabled. There are
 * two independent disable lists:
 *
 *   - **global** — disabled for every project (stored in `~/.glassbox/config.json`
 *     under `disabledPlugins`).
 *   - **project** — disabled for this repo (stored in `.glassbox/settings.json`
 *     under `disabledPlugins`).
 *
 * A plugin is enabled iff it is in **neither** list. **Global takes precedence**:
 * a globally-disabled plugin reports scope `global` even if also project-disabled
 * (there is no project-level re-enable of a globally-disabled plugin).
 */
import { readGlobalConfig, updateGlobalConfig } from '../global-config.js';
import { readProjectSettings, updateProjectSettings } from '../project-settings-store.js';

export type DisabledScope = 'global' | 'project';

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function readGlobalDisabled(): string[] {
  return toStringArray(readGlobalConfig().disabledPlugins);
}

export function setGlobalDisabled(id: string, disabled: boolean): void {
  updateGlobalConfig((cfg) => {
    const cur = toStringArray(cfg.disabledPlugins);
    const next = disabled ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    return { ...cfg, disabledPlugins: next };
  });
}

export function readProjectDisabled(repoRoot: string): string[] {
  return toStringArray(readProjectSettings(repoRoot).disabledPlugins);
}

export function setProjectDisabled(repoRoot: string, id: string, disabled: boolean): void {
  updateProjectSettings(repoRoot, (s) => {
    const cur = toStringArray(s.disabledPlugins);
    s.disabledPlugins = disabled ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
  });
}

export interface EnablementLists {
  globalDisabled: readonly string[];
  projectDisabled: readonly string[];
}

/** Which scope, if any, disables this plugin — global wins over project. */
export function disabledScope(id: string, lists: EnablementLists): DisabledScope | null {
  if (lists.globalDisabled.includes(id)) return 'global';
  if (lists.projectDisabled.includes(id)) return 'project';
  return null;
}

/** Enabled iff disabled by neither scope. */
export function isPluginEnabled(id: string, lists: EnablementLists): boolean {
  return disabledScope(id, lists) === null;
}

/** Read both disable lists for a repo (global + that project). */
export function readEnablementLists(repoRoot: string): EnablementLists {
  return { globalDisabled: readGlobalDisabled(), projectDisabled: readProjectDisabled(repoRoot) };
}
