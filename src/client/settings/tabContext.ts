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

  // Mutators — let tabs change state without owning the dialog's closure.
  setCurrentPlatform: (platform: string) => void;
  setCurrentModel: (model: string) => void;
  setGuidedEnabled: (enabled: boolean) => void;
  setShowMoreLangs: (b: boolean) => void;
  setAppName: (name: string) => void;
  setActiveThemeId: (id: string) => void;
  setChannelEnabled: (enabled: boolean) => void;

  // Cross-tab actions.
  saveConfig: () => void;
  saveKey: () => void;
  removeKey: () => void;
  toggleTopic: (topic: string) => void;
  saveAppNameDebounced: () => void;
  switchTheme: (id: string) => void;
  showThemeManager: (onClose: () => void) => void;
  refreshThemes: () => Promise<ThemesResponse>;
  renderContent: () => void;
}

export interface Tab {
  id: string;
  label: string;
  icon: SafeHtml;
  enabled?: (ctx: TabContext) => boolean;
  render: (ctx: TabContext) => SafeHtml;
  bind: (overlay: HTMLElement, ctx: TabContext) => void;
}
