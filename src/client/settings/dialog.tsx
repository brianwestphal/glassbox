import type { SafeHtml, Signal } from 'kerfjs';
import { delegate, mount, signal } from 'kerfjs';

import type { AIPlatform, KeyStorage } from '../../api/index.js';
import {
  deleteAIKey,
  disableChannel,
  enableChannel,
  getAIConfig,
  getAIKeyStatus,
  getChannelStatus,
  getClaudeCheck,
  getProjectSettings,
  listAIModels,
  listThemes,
  saveAIConfig,
  saveAIKey,
  updateProjectSettings,
} from '../../api/index.js';
import { asButton, asEl, asInput, asSelect, toElement } from '../dom.js';
import { invalidateGuidedAnalysis } from '../guided.js';
import { triggerShare } from '../share.js';
import { invalidateAnalysisCache } from '../sidebar/sortMode.js';
import { aiStore } from '../stores/index.js';
import { getTauriGlobal, getTauriInvoke, showUpdateBanner } from '../tauri.js';
import { switchTheme } from '../themes.js';
import { SETTINGS_APP_NAME_DEBOUNCE_MS, SETTINGS_CONFIG_DEBOUNCE_MS, TOAST_DURATION_MS } from '../timing.js';
import { experimentalTab } from './experimentalTab.js';
import { generalTab } from './generalTab.js';
import { ALL_LANG_KEYS, profileTab } from './profileTab.js';
import type { ChannelState, ConfigResponse, KeyStatusResponse, ModelsResponse, ProjectSettings, Tab, TabContext, ThemesResponse } from './tabContext.js';
import { showThemeManager } from './themeManager.js';
import { updatesTab } from './updatesTab.js';

const TABS: Tab[] = [generalTab, profileTab, experimentalTab, updatesTab];

interface SettingsUIState {
  activeTab: string;
  currentPlatform: string;
  currentModel: string;
  guidedEnabled: boolean;
  guidedTopics: Set<string>;
  showMoreLangs: boolean;
  appName: string;
  activeThemeId: string;
}

export function showSettingsDialog(onClose?: () => void): void {
  void (async () => {
    const [keyStatus, modelsData, configData, projectSettings, themesData, channelCheck, channelStatus] = await Promise.all([
      getAIKeyStatus(),
      listAIModels(),
      getAIConfig(),
      getProjectSettings(),
      listThemes(),
      getClaudeCheck(),
      getChannelStatus(),
    ]);

    const channelState: ChannelState = {
      enabled: channelStatus.enabled,
      claudeInstalled: channelCheck.installed,
      claudeVersion: channelCheck.version,
      meetsMinimum: channelCheck.meetsMinimum,
    };

    renderSettingsModal(keyStatus, modelsData, configData, projectSettings, themesData, channelState, onClose);
  })();
}

function renderSettingsModal(
  keyStatus: KeyStatusResponse,
  modelsData: ModelsResponse,
  configData: ConfigResponse,
  projectSettings: ProjectSettings,
  themesData: ThemesResponse,
  channelState: ChannelState,
  onClose?: () => void,
): void {
  const isTauri = getTauriGlobal() !== undefined;

  // Per-dialog reactive state. Bumps to this signal drive the mount()
  // re-render. The signal lives in this closure (not in the global
  // `stores/index.ts`) because it represents a transient modal — opening the
  // dialog a second time should fetch fresh server data and reset live UI.
  const ui = signal<SettingsUIState>({
    activeTab: 'general',
    currentPlatform: configData.platform,
    currentModel: configData.model,
    guidedEnabled: configData.guidedReview.enabled,
    guidedTopics: new Set(configData.guidedReview.topics),
    showMoreLangs: false,
    appName: projectSettings.appName ?? '',
    activeThemeId: themesData.activeId,
  });

  const overlay = toElement(<div className="modal-overlay"><div className="modal settings-dialog"></div></div>);
  const modalEl = overlay.querySelector<HTMLElement>('.modal');
  if (modalEl === null) return;

  function setUi(partial: Partial<SettingsUIState>): void {
    ui.value = { ...ui.value, ...partial };
  }
  function forceRerender(): void {
    ui.value = { ...ui.value };
  }

  const actions = createActions({ ui, setUi, forceRerender, keyStatus, projectSettings, configData, channelState, overlay, modelsData, themesData });

  let disposeMount: (() => void) | null = null;
  function closeDialog(): void {
    actions.dispose();
    document.removeEventListener('keydown', handleEscape);
    if (disposeMount !== null) disposeMount();
    overlay.remove();
    if (onClose !== undefined) onClose();
  }

  function handleEscape(e: KeyboardEvent): void {
    if (e.key === 'Escape') closeDialog();
  }

  // Mount the reactive shell.
  disposeMount = mount(modalEl, () => {
    const ctx = buildContext({ ui, isTauri, keyStatus, modelsData, themesData, projectSettings, channelState, actions });
    const visible = TABS.filter(t => t.enabled === undefined || t.enabled(ctx));
    const cur = ui.value;
    let activeId = cur.activeTab;
    if (!visible.some(t => t.id === activeId)) {
      activeId = visible[0]?.id ?? 'general';
      // Defer the state correction so we don't write during a render.
      queueMicrotask(() => { setUi({ activeTab: activeId }); });
    }
    return renderShell(visible, activeId, ctx);
  });

  setupDelegates({ overlay, setUi, forceRerender, actions, modelsData, themesData, channelState, closeDialog });

  document.addEventListener('keydown', handleEscape);
  document.body.appendChild(overlay);
}

// --- Action handlers (closure-bound, returned as an object so they can be
//     passed to TabContext + the delegate setup without duplicating closure
//     wiring).

interface ActionDeps {
  ui: Signal<SettingsUIState>;
  setUi: (p: Partial<SettingsUIState>) => void;
  forceRerender: () => void;
  keyStatus: KeyStatusResponse;
  projectSettings: ProjectSettings;
  configData: ConfigResponse;
  channelState: ChannelState;
  overlay: HTMLElement;
  modelsData: ModelsResponse;
  themesData: ThemesResponse;
}

interface Actions {
  saveConfig: () => void;
  saveConfigDebounced: () => void;
  saveAppNameDebounced: () => void;
  saveKey: () => void;
  removeKey: () => void;
  toggleTopic: (topic: string) => void;
  dispose: () => void;
}

function createActions(deps: ActionDeps): Actions {
  const { ui, setUi, forceRerender, keyStatus, projectSettings, configData, overlay } = deps;
  let lastSavedGuidedEnabled = configData.guidedReview.enabled;
  let lastSavedGuidedTopics = new Set(configData.guidedReview.topics);
  let configTimer: ReturnType<typeof setTimeout> | null = null;
  let appNameTimer: ReturnType<typeof setTimeout> | null = null;

  /** Surface a transient error when a settings save/remove request fails, so a
   *  failure isn't silent. Appended to `overlay` (not the mounted modal body)
   *  so a re-render can't clobber it; auto-dismisses. */
  function flashSettingsError(message: string): void {
    overlay.querySelector('.settings-error-toast')?.remove();
    const toast = toElement(<div className="settings-error-toast">{message}</div>);
    overlay.appendChild(toast);
    setTimeout(() => { toast.remove(); }, TOAST_DURATION_MS);
  }

  function saveConfig(): void {
    const cur = ui.value;
    const newTopics = Array.from(cur.guidedTopics);
    const guidedChanged = cur.guidedEnabled !== lastSavedGuidedEnabled
      || newTopics.length !== lastSavedGuidedTopics.size
      || newTopics.some(t => !lastSavedGuidedTopics.has(t));

    void (async () => {
      try {
        await saveAIConfig({
          platform: cur.currentPlatform as AIPlatform,
          model: cur.currentModel,
          guidedReview: { enabled: cur.guidedEnabled, topics: newTopics },
        });

        const newConfig = await getAIConfig();
        aiStore.actions.update({
          aiConfigured: newConfig.keyConfigured,
          guidedReviewEnabled: cur.guidedEnabled,
        });
        configData.guidedReview = { enabled: cur.guidedEnabled, topics: newTopics };

        if (guidedChanged && aiStore.state.value.aiConfigured) {
          invalidateAnalysisCache();
          invalidateGuidedAnalysis();
        }

        lastSavedGuidedEnabled = cur.guidedEnabled;
        lastSavedGuidedTopics = new Set(cur.guidedTopics);
      } catch {
        flashSettingsError('Couldn’t save settings — please try again.');
      }
    })();
  }

  function saveConfigDebounced(): void {
    if (configTimer) clearTimeout(configTimer);
    configTimer = setTimeout(saveConfig, SETTINGS_CONFIG_DEBOUNCE_MS);
  }

  function saveAppNameDebounced(): void {
    if (appNameTimer) clearTimeout(appNameTimer);
    appNameTimer = setTimeout(() => {
      const val = ui.value.appName.trim();
      if (val !== (projectSettings.appName ?? '')) {
        void updateProjectSettings({ appName: val });
        projectSettings.appName = val || undefined;
      }
    }, SETTINGS_APP_NAME_DEBOUNCE_MS);
  }

  function saveKey(): void {
    const keyInput = overlay.querySelector<HTMLInputElement>('#settings-key');
    if (keyInput === null || keyInput.value.trim() === '') return;
    const storageRadio = overlay.querySelector<HTMLInputElement>('input[name="key-storage"]:checked');
    const storage = storageRadio?.value ?? 'config';
    void (async () => {
      try {
        await saveAIKey({
          platform: ui.value.currentPlatform as AIPlatform,
          key: keyInput.value.trim(),
          storage: storage as KeyStorage,
        });
        const newStatus = await getAIKeyStatus();
        keyStatus.status = newStatus.status;
        const newConfig = await getAIConfig();
        aiStore.actions.update({ aiConfigured: newConfig.keyConfigured });
        forceRerender();
      } catch {
        flashSettingsError('Couldn’t save the API key — please try again.');
      }
    })();
  }

  function removeKey(): void {
    void (async () => {
      try {
        await deleteAIKey({ platform: ui.value.currentPlatform as AIPlatform });
        const newStatus = await getAIKeyStatus();
        keyStatus.status = newStatus.status;
        const newConfig = await getAIConfig();
        aiStore.actions.update({ aiConfigured: newConfig.keyConfigured });
        forceRerender();
      } catch {
        flashSettingsError('Couldn’t remove the API key — please try again.');
      }
    })();
  }

  function toggleTopic(topic: string): void {
    const cur = ui.value;
    const next = new Set(cur.guidedTopics);
    let showMoreLangs = cur.showMoreLangs;
    if (next.has(topic)) {
      next.delete(topic);
    } else {
      next.add(topic);
      if (topic === 'programming') {
        const hasAnyLang = [...next].some(t => ALL_LANG_KEYS.has(t));
        if (!hasAnyLang) {
          for (const key of ALL_LANG_KEYS) next.add(key);
          showMoreLangs = true;
        }
      }
    }
    setUi({ guidedTopics: next, showMoreLangs });
    saveConfigDebounced();
  }

  function dispose(): void {
    if (configTimer) clearTimeout(configTimer);
    if (appNameTimer) clearTimeout(appNameTimer);
  }

  return { saveConfig, saveConfigDebounced, saveAppNameDebounced, saveKey, removeKey, toggleTopic, dispose };
}

// --- TabContext construction ---

function buildContext(args: {
  ui: Signal<SettingsUIState>;
  isTauri: boolean;
  keyStatus: KeyStatusResponse;
  modelsData: ModelsResponse;
  themesData: ThemesResponse;
  projectSettings: ProjectSettings;
  channelState: ChannelState;
  actions: Actions;
}): TabContext {
  const cur = args.ui.value;
  return {
    keyStatus: args.keyStatus, modelsData: args.modelsData, themesData: args.themesData,
    projectSettings: args.projectSettings, channelState: args.channelState,
    isTauri: args.isTauri,
    currentPlatform: cur.currentPlatform,
    currentModel: cur.currentModel,
    guidedEnabled: cur.guidedEnabled,
    guidedTopics: cur.guidedTopics,
    showMoreLangs: cur.showMoreLangs,
    appName: cur.appName,
    activeThemeId: cur.activeThemeId,
    saveConfig: args.actions.saveConfig,
    saveKey: args.actions.saveKey,
    removeKey: args.actions.removeKey,
    toggleTopic: args.actions.toggleTopic,
    saveAppNameDebounced: args.actions.saveAppNameDebounced,
    switchTheme: (id: string) => void switchTheme(id),
    showThemeManager,
    refreshThemes: () => listThemes().then(updated => {
      args.themesData.themes = updated.themes;
      args.themesData.activeId = updated.activeId;
      return updated;
    }),
  };
}

// --- Delegated event handlers ---
// One `delegate(overlay, …)` per concern; fires for every re-render
// automatically. Grouped by tab for readability.

function setupDelegates(args: {
  overlay: HTMLElement;
  setUi: (p: Partial<SettingsUIState>) => void;
  forceRerender: () => void;
  actions: Actions;
  modelsData: ModelsResponse;
  themesData: ThemesResponse;
  channelState: ChannelState;
  closeDialog: () => void;
}): void {
  const { overlay, setUi, forceRerender, actions, modelsData, themesData, channelState, closeDialog } = args;

  void delegate(overlay, 'click', '#settings-close', closeDialog);
  void delegate(overlay, 'click', '[data-tab]', (_e, btn) => {
    const t = asEl(btn).dataset.tab;
    if (t !== undefined) setUi({ activeTab: t });
  });

  // General tab
  void delegate(overlay, 'change', '#settings-theme', (_e, sel) => {
    const id = asSelect(sel).value;
    setUi({ activeThemeId: id });
    void switchTheme(id);
  });
  void delegate(overlay, 'click', '#manage-themes-btn', () => {
    showThemeManager(() => {
      void (async () => {
        const updated = await listThemes();
        themesData.themes = updated.themes;
        themesData.activeId = updated.activeId;
        setUi({ activeThemeId: updated.activeId });
      })();
    });
  });
  void delegate(overlay, 'click', '#settings-share-link', (e) => {
    e.preventDefault();
    void triggerShare();
  });
  void delegate(overlay, 'input', '#settings-app-name', (_e, input) => {
    setUi({ appName: asInput(input).value });
    actions.saveAppNameDebounced();
  });

  // Profile tab
  void delegate(overlay, 'click', '.settings-tag', (_e, tag) => {
    const topic = asEl(tag).dataset.topic;
    if (topic !== undefined) actions.toggleTopic(topic);
  });
  void delegate(overlay, 'click', '#show-more-langs', () => { setUi({ showMoreLangs: true }); });

  // Experimental tab
  void delegate(overlay, 'click', '.settings-platform-control [data-platform]', (_e, btn) => {
    const platform = asEl(btn).dataset.platform;
    if (platform === undefined) return;
    const models = modelsData.models[platform as AIPlatform];
    const defaultModel = models.find(m => m.isDefault);
    const newModel = defaultModel ? defaultModel.id : (models[0]?.id ?? '');
    setUi({ currentPlatform: platform, currentModel: newModel });
    actions.saveConfig();
  });
  void delegate(overlay, 'change', '#settings-model', (_e, sel) => {
    setUi({ currentModel: asSelect(sel).value });
    actions.saveConfig();
  });
  void delegate(overlay, 'click', '#remove-key', actions.removeKey);
  void delegate(overlay, 'click', '#save-key-btn', actions.saveKey);
  void delegate(overlay, 'keydown', '#settings-key', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter') { ke.preventDefault(); actions.saveKey(); }
  });
  void delegate(overlay, 'change', '#settings-guided-enabled', (_e, cb) => {
    setUi({ guidedEnabled: asInput(cb).checked });
    actions.saveConfig();
  });
  void delegate(overlay, 'change', '#settings-channel-enabled', (_e, cb) => {
    const enabled = asInput(cb).checked;
    channelState.enabled = enabled;
    void (enabled ? enableChannel() : disableChannel());
    forceRerender();
  });
  void delegate(overlay, 'click', '#channel-copy-btn', (_e, btn) => {
    void navigator.clipboard.writeText('claude --dangerously-load-development-channels server:glassbox-channel');
    const el = asEl(btn);
    el.textContent = 'Copied!';
    setTimeout(() => { el.textContent = 'Copy'; }, TOAST_DURATION_MS);
  });

  // Updates tab
  void delegate(overlay, 'click', '#check-updates-btn', (_e, btn) => {
    void handleCheckUpdates(asButton(btn), overlay);
  });

  // Click outside (on the dimmed overlay background) closes the dialog. Bound
  // directly on the overlay element — it's the modal root, not inside a
  // mount() tree, so a direct listener survives.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });
}

async function handleCheckUpdates(btn: HTMLButtonElement, overlay: HTMLElement): Promise<void> {
  const status = overlay.querySelector<HTMLElement>('#check-updates-status');
  if (status === null) return;
  const invoke = getTauriInvoke();
  if (!invoke) return;
  btn.disabled = true;
  btn.textContent = 'Checking...';
  status.textContent = '';
  try {
    const version = (await invoke('check_for_update')) as string | null;
    if (version !== null && version !== '') {
      status.textContent = `Update available: v${version}`;
      showUpdateBanner(version);
    } else {
      status.textContent = 'Your software is up to date.';
    }
  } catch {
    status.textContent = 'Could not check for updates.';
  }
  btn.textContent = 'Check for Updates';
  btn.disabled = false;
}

function renderShell(visible: Tab[], activeTabId: string, ctx: TabContext): SafeHtml {
  return (
    <>
      <div className="settings-header">
        <h3>Settings</h3>
        <button className="settings-close" id="settings-close">&times;</button>
      </div>

      <div className="settings-tabs">
        {visible.map(tab => (
          <button className={`settings-tab${tab.id === activeTabId ? ' active' : ''}`} data-tab={tab.id}>
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="settings-body">
        {visible.map(tab => (
          <div className={`settings-tab-panel${tab.id === activeTabId ? ' active' : ''}`} data-panel={tab.id}>
            {tab.render(ctx)}
          </div>
        ))}
      </div>
    </>
  );
}
