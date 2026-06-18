import type { SafeHtml } from 'kerfjs';

import type {
  DifftoolStatusResp,
  GetAIKeyStatusResp,
  GetProjectSettingsResp,
  ListAIModelsResp,
  ListThemesResp,
} from '../../api/index.js';

// Per-tab type aliases re-export the shared API response shapes so the
// dialog and its tabs all agree with the server contract in `src/api/`.
export type {
  AIConfigResp as ConfigResponse,
  GetAIKeyStatusResp as KeyStatusResponse,
  ListAIModelsResp as ModelsResponse,
  GetProjectSettingsResp as ProjectSettings,
  ListThemesResp as ThemesResponse,
  ThemeSummary,
} from '../../api/index.js';

export interface ChannelState {
  enabled: boolean;
  claudeInstalled: boolean;
  claudeVersion: string | null;
  meetsMinimum: boolean;
}

/**
 * Shared bag passed to every tab's `render` and `bind`. Tabs read whatever
 * fields they need and ignore the rest. New tabs slot in by adding a
 * registry entry — no edits to the modal shell or to a switch statement.
 */
export interface TabContext {
  // Server data (mutated by save handlers when the server returns fresh data).
  keyStatus: GetAIKeyStatusResp;
  modelsData: ListAIModelsResp;
  themesData: ListThemesResp;
  projectSettings: GetProjectSettingsResp;
  channelState: ChannelState;

  // Live form state.
  isTauri: boolean;
  currentPlatform: string;
  currentModel: string;
  localEndpoint: string;
  guidedEnabled: boolean;
  guidedTopics: Set<string>;
  showMoreLangs: boolean;
  appName: string;
  activeThemeId: string;

  // GB-850 — current `git difftool` registration state at --global scope.
  // The General tab reads this to render either a "Register" or "Registered"
  // affordance; the registerDifftool/unregisterDifftool actions refetch and
  // update it.
  difftoolStatus: DifftoolStatusResp;

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
  refreshThemes: () => Promise<ListThemesResp>;
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
