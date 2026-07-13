/**
 * Settings → Plugins tab (doc 29, GB-1040). Lists installed content plugins with
 * their state (active / disabled / failed), lets the user disable a plugin
 * globally or per-project (enabled by default; global disable wins), and
 * install-from-a-folder / uninstall. Self-contained: its state lives in a module
 * signal the tab's `render` reads, so an API round-trip re-renders the dialog.
 */
import type { SafeHtml } from 'kerfjs';
import { signal } from 'kerfjs';

import type { ConfigLabelColor, ConfigLayoutItem, PluginInfo, PluginPreferenceInfo } from '../../api/index.js';
import { installPlugin, listPlugins, runPluginAction, setPluginDisabled, setPluginPreference, uninstallPlugin } from '../../api/index.js';
import { IconChevronRight, IconPlug } from '../../icons.js';
import { getTauriInvoke } from '../tauri.js';
import type { Tab } from './tabContext.js';

const plugins = signal<PluginInfo[] | null>(null);
const installError = signal<string>('');

/** Reset the tab's state — called when the dialog opens. */
export function resetPluginsTab(): void {
  plugins.value = null;
  installError.value = '';
}

/** Fetch the installed-plugin list (called when the tab is first shown). */
export function loadPluginsList(): void {
  if (plugins.value !== null) return;
  void listPlugins()
    .then((r) => { plugins.value = r.plugins; })
    .catch(() => { plugins.value = []; });
}

export function togglePluginDisabled(id: string, scope: 'global' | 'project', disabled: boolean): void {
  void setPluginDisabled(id, { scope, disabled })
    .then((r) => { plugins.value = r.plugins; })
    .catch(() => { /* leave the current list; the checkbox reflects server truth on next load */ });
}

export function doUninstallPlugin(id: string): void {
  void uninstallPlugin(id)
    .then((r) => { plugins.value = r.plugins; })
    .catch(() => {});
}

export function setPreference(id: string, key: string, value: string): void {
  void setPluginPreference(id, { key, value })
    .then((r) => { plugins.value = r.plugins; })
    .catch(() => {});
}

/** Run a config-layout button action (doc 29 FR-29.18); the refreshed list
 *  carries any dynamic labels the action set. */
export function doPluginAction(id: string, actionId: string): void {
  installError.value = '';
  void runPluginAction(id, { actionId })
    .then((r) => { plugins.value = r.plugins; installError.value = r.error ?? ''; })
    .catch((e: unknown) => { installError.value = e instanceof Error ? e.message : 'Action failed'; });
}

export function doInstallPlugin(path: string): void {
  if (path.trim() === '') return;
  installError.value = '';
  void installPlugin({ path: path.trim() })
    .then((r) => {
      plugins.value = r.plugins;
      installError.value = r.error ?? '';
      // On success, clear the field so it's clear the install ran (re-installing
      // an already-present plugin otherwise looks like nothing happened).
      if (r.error === undefined) {
        const input = document.getElementById('plugin-install-path');
        if (input instanceof HTMLInputElement) input.value = '';
      }
    })
    .catch((e: unknown) => { installError.value = e instanceof Error ? e.message : 'Install failed'; });
}

/** Desktop only (doc 29, GB-1048): open a native folder picker and put the chosen
 *  path into the install field — the user then clicks **Install** (Browse only
 *  fills the field; it doesn't install on its own). No-op in the browser. */
export function browsePluginFolder(): void {
  const invoke = getTauriInvoke();
  if (invoke === null) return;
  void invoke('pick_plugin_folder').then((path) => {
    if (typeof path !== 'string' || path === '') return;
    const input = document.getElementById('plugin-install-path');
    if (input instanceof HTMLInputElement) {
      input.value = path;
      input.focus();
    }
    installError.value = '';
  }).catch(() => {});
}

function preferenceField(id: string, pref: PluginPreferenceInfo, value: string, secretConfigured: boolean): SafeHtml {
  const common = { 'data-plugin-pref-id': id, 'data-plugin-pref-key': pref.key } as const;
  const control =
    pref.secret === true ? (
      // Secret prefs (GB-1054): masked, value never pre-filled; the placeholder
      // reflects whether one is already stored in the keychain.
      <input type="password" className="settings-input plugin-pref-input" autoComplete="off"
        {...common} placeholder={secretConfigured ? 'Stored — enter to replace, blank to clear' : 'Not set'} />
    ) : pref.type === 'boolean' ? (
      <input type="checkbox" className="plugin-pref-checkbox" {...common} checked={value === 'true'} />
    ) : pref.type === 'select' ? (
      <select className="settings-input plugin-pref-select" {...common}>
        {(pref.options ?? []).map((opt) => <option value={opt} selected={opt === value}>{opt}</option>)}
      </select>
    ) : (
      <input type={pref.type === 'number' ? 'number' : 'text'} className="settings-input plugin-pref-input"
        {...common} value={value} />
    );
  return (
    <label className="plugin-pref" data-key={pref.key}>
      <span className="plugin-pref-label">{pref.label}</span>
      {control}
      {pref.description !== undefined && pref.description !== '' && <span className="plugin-pref-desc">{pref.description}</span>}
    </label>
  );
}

function prefFieldFor(p: PluginInfo, pref: PluginPreferenceInfo): SafeHtml {
  // The server resolves each declared preference's value (default folded in) into
  // preferenceValues, so a declared pref always has an entry here.
  return preferenceField(p.id, pref, p.preferenceValues[pref.key], p.secretConfigured.includes(pref.key));
}

/** CSS class for a config-layout label's semantic tone (doc 29 FR-29.18). */
function labelColorClass(color: ConfigLabelColor | undefined): string {
  return color === undefined || color === 'default'
    ? 'plugin-config-label'
    : `plugin-config-label plugin-config-label-${color}`;
}

/** Render one config-layout node (doc 29 FR-29.18). `group` recurses. A
 *  `preference` referencing an unknown key is skipped (like Hot Sheet). */
function configItemJsx(p: PluginInfo, item: ConfigLayoutItem): SafeHtml | null {
  switch (item.type) {
    case 'preference': {
      const pref = item.key !== undefined ? p.preferences.find((x) => x.key === item.key) : undefined;
      return pref === undefined ? null : prefFieldFor(p, pref);
    }
    case 'divider':
      return <hr className="plugin-config-divider" />;
    case 'spacer':
      return <div className="plugin-config-spacer"></div>;
    case 'label': {
      // Prefer the server-resolved effective label (manifest default merged with
      // any runtime override); fall back to the manifest text.
      const resolved = item.id !== undefined ? p.configLabels[item.id] : undefined;
      const text = resolved?.text ?? item.text ?? '';
      const color = resolved?.color ?? item.color;
      return <div className={labelColorClass(color)} data-key={`label-${item.id ?? ''}`}>{text}</div>;
    }
    case 'button':
      if (item.action === undefined || item.action === '') return null;
      return (
        <button
          type="button"
          className={`btn btn-xs${item.style === 'primary' ? ' btn-primary' : ''} plugin-config-btn`}
          data-plugin-action={p.id}
          data-plugin-action-id={item.action}
        >{item.label ?? 'Run'}</button>
      );
    case 'group': {
      const collapsed = item.collapsed === true;
      return (
        <details className="plugin-config-group" open={!collapsed} data-key={`group-${item.title ?? ''}`}>
          <summary className="plugin-config-group-header">
            <span className="plugin-config-chevron"><IconChevronRight /></span>
            <span className="plugin-config-group-title">{item.title ?? 'Group'}</span>
          </summary>
          <div className="plugin-config-group-body">
            {(item.items ?? []).map((child) => configItemJsx(p, child))}
          </div>
        </details>
      );
    }
    default:
      return null;
  }
}

function preferencesJsx(p: PluginInfo): SafeHtml | null {
  // A manifest may arrange its preferences via configLayout (doc 29 FR-29.18);
  // otherwise fall back to a flat list of every declared preference.
  if (p.configLayout !== undefined && p.configLayout.length > 0) {
    return <div className="plugin-row-prefs">{p.configLayout.map((item) => configItemJsx(p, item))}</div>;
  }
  if (p.preferences.length === 0) return null;
  return (
    <div className="plugin-row-prefs">
      {p.preferences.map((pref) => prefFieldFor(p, pref))}
    </div>
  );
}

function pluginRow(p: PluginInfo): SafeHtml {
  const dotClass = p.status === 'error' ? 'error' : p.enabled ? 'ok' : 'disabled';
  const state =
    p.status === 'error' ? `Failed: ${p.error ?? 'unknown error'}`
    : p.enabled ? 'Active'
    : p.disabledScope === 'global' ? 'Disabled (all projects)'
    : 'Disabled (this project)';
  return (
    <div className="plugin-row" data-key={p.id}>
      <div className="plugin-row-main">
        <span className={`plugin-dot ${dotClass}`}></span>
        <div className="plugin-row-text">
          <div className="plugin-row-title">{p.name} <span className="plugin-version">v{p.version}</span></div>
          <div className="plugin-row-meta">{p.extensions.length > 0 ? p.extensions.join('  ') : 'no declared types'} · {state}</div>
        </div>
        <button className="btn btn-xs btn-danger" data-plugin-uninstall={p.id}>Uninstall</button>
      </div>
      {p.status !== 'error' && (
        <div className="plugin-row-toggles">
          <label className="settings-checkbox">
            <input type="checkbox" data-plugin-toggle="global" data-plugin-id={p.id} checked={!p.globalDisabled} />
            <span>Enabled (all projects)</span>
          </label>
          <label className={`settings-checkbox${p.globalDisabled ? ' settings-checkbox-disabled' : ''}`}>
            <input type="checkbox" data-plugin-toggle="project" data-plugin-id={p.id} checked={!p.projectDisabled} disabled={p.globalDisabled} />
            <span>Enabled (this project)</span>
          </label>
        </div>
      )}
      {p.status !== 'error' && preferencesJsx(p)}
    </div>
  );
}

function renderPluginsTab(): SafeHtml {
  const list = plugins.value;
  return (
    <div className="settings-section">
      <h3>Content plugins</h3>
      <p className="settings-hint">
        Plugins render specialized content types (e.g. diagrams). Installed plugins are enabled by
        default; disable one for this project or for all projects. A globally-disabled plugin can't
        be enabled per project.
      </p>
      {list === null ? (
        <p className="settings-hint">Loading…</p>
      ) : list.length === 0 ? (
        <p className="settings-hint">No plugins installed.</p>
      ) : (
        <div className="plugin-list">{list.map((p) => pluginRow(p))}</div>
      )}
      <div className="plugin-install">
        <label className="settings-label" htmlFor="plugin-install-path">Install from a folder</label>
        <div className="settings-key-row">
          <input type="text" className="settings-input" id="plugin-install-path" placeholder="/path/to/plugin-folder" autoComplete="off" />
          {getTauriInvoke() !== null && <button className="btn btn-xs" id="plugin-browse-btn">Browse…</button>}
          <button className="btn btn-xs btn-primary" id="plugin-install-btn">Install</button>
        </div>
        {installError.value !== '' && <p className="settings-plugin-error">{installError.value}</p>}
      </div>
    </div>
  );
}

export const pluginsTab: Tab = {
  id: 'plugins',
  label: 'Plugins',
  icon: <IconPlug />,
  render: () => renderPluginsTab(),
};
