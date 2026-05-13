import type { SafeHtml } from 'kerfjs';

export interface ChannelState {
  enabled: boolean;
  claudeInstalled: boolean;
  claudeVersion: string | null;
  meetsMinimum: boolean;
}

export interface ThemeSummary {
  id: string;
  name: string;
  builtIn: boolean;
}

export interface KeyStatusInfo {
  configured: boolean;
  source: string | null;
}

export interface KeyStatusResponse {
  status: Record<string, KeyStatusInfo>;
  keychainAvailable: boolean;
  keychainLabel: string;
}

export interface ModelsResponse {
  platforms: Record<string, string>;
  models: Record<string, Array<{ id: string; name: string; isDefault: boolean }>>;
}

export interface ThemesResponse {
  themes: ThemeSummary[];
  activeId: string;
}

export interface ProjectSettings {
  appName?: string;
}

/**
 * Shared bag passed to every tab's `render` and `bind`. Tabs read whatever
 * fields they need and ignore the rest. New tabs slot in by adding a
 * registry entry — no edits to the modal shell or to a switch statement.
 */
export interface TabContext {
  // Server data (mutated by save handlers when the server returns fresh data).
  keyStatus: KeyStatusResponse;
  modelsData: ModelsResponse;
  themesData: ThemesResponse;
  projectSettings: ProjectSettings;
  channelState: ChannelState;

  // Live form state.
  isTauri: boolean;
  currentPlatform: string;
  currentModel: string;
  guidedEnabled: boolean;
  guidedTopics: Set<string>;
  showMoreLangs: boolean;
  appName: string;
  activeThemeId: string;

  // Cross-tab actions kept for the small number of tabs whose render fn
  // emits inline event handlers (e.g. updates-tab status text). Most tab
  // interactions flow through the centralized `delegate(overlay, …)` calls
  // in `dialog.tsx`, not through this context.
  saveConfig: () => void;
  saveKey: () => void;
  removeKey: () => void;
  toggleTopic: (topic: string) => void;
  saveAppNameDebounced: () => void;
  switchTheme: (id: string) => void;
  showThemeManager: (onClose: () => void) => void;
  refreshThemes: () => Promise<ThemesResponse>;
}

export interface Tab {
  id: string;
  label: string;
  icon: SafeHtml;
  enabled?: (ctx: TabContext) => boolean;
  render: (ctx: TabContext) => SafeHtml;
  // Optional — kept for compatibility while tabs migrate from per-tab
  // bindings to the centralized `delegate()` handlers in `dialog.tsx`.
  bind?: (overlay: HTMLElement, ctx: TabContext) => void;
}
