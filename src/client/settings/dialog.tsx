import type { SafeHtml } from 'kerfjs';

import { api } from '../api.js';
import { toElement } from '../dom.js';
import { invalidateGuidedAnalysis } from '../guided.js';
import { invalidateAnalysisCache } from '../sidebar/sortMode.js';
import { aiStore } from '../stores/index.js';
import { switchTheme } from '../themes.js';
import { SETTINGS_APP_NAME_DEBOUNCE_MS, SETTINGS_CONFIG_DEBOUNCE_MS } from '../timing.js';
import { experimentalTab } from './experimentalTab.js';
import { generalTab } from './generalTab.js';
import { ALL_LANG_KEYS, profileTab } from './profileTab.js';
import type { ChannelState, KeyStatusResponse, ModelsResponse, ProjectSettings, Tab, TabContext, ThemesResponse } from './tabContext.js';
import { showThemeManager } from './themeManager.js';
import { updatesTab } from './updatesTab.js';

const TABS: Tab[] = [generalTab, profileTab, experimentalTab, updatesTab];

interface ConfigResponse {
  platform: string;
  model: string;
  keyConfigured: boolean;
  keySource: string | null;
  guidedReview: { enabled: boolean; topics: string[] };
}

export function showSettingsDialog(onClose?: () => void) {
  void (async () => {
    const [keyStatus, modelsData, configData, projectSettings, themesData, channelCheck, channelStatus] = await Promise.all([
      api<KeyStatusResponse>('/ai/key-status'),
      api<ModelsResponse>('/ai/models'),
      api<ConfigResponse>('/ai/config'),
      api<ProjectSettings>('/project-settings'),
      api<ThemesResponse>('/themes'),
      api<{ installed: boolean; version: string | null; meetsMinimum: boolean }>('/channel/claude-check'),
      api<{ enabled: boolean; connected: boolean }>('/channel/status'),
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
) {
  const overlay = toElement(<div className="modal-overlay"></div>);

  // Mutable per-dialog state lives here; tabs touch it via the TabContext mutators.
  const ui = {
    activeTab: 'general',
    isTauri: (window as unknown as Record<string, unknown>).__TAURI__ !== undefined,
    currentPlatform: configData.platform,
    currentModel: configData.model,
    guidedEnabled: configData.guidedReview.enabled,
    guidedTopics: new Set(configData.guidedReview.topics),
    showMoreLangs: false,
    appName: projectSettings.appName ?? '',
    activeThemeId: themesData.activeId,
    lastSavedGuidedEnabled: configData.guidedReview.enabled,
    lastSavedGuidedTopics: new Set(configData.guidedReview.topics),
  };

  let configTimer: ReturnType<typeof setTimeout> | null = null;
  let appNameTimer: ReturnType<typeof setTimeout> | null = null;

  function closeDialog() {
    if (configTimer) clearTimeout(configTimer);
    if (appNameTimer) clearTimeout(appNameTimer);
    document.removeEventListener('keydown', handleEscape);
    overlay.remove();
    if (onClose !== undefined) onClose();
  }

  function handleEscape(e: KeyboardEvent) {
    if (e.key === 'Escape') closeDialog();
  }

  function saveConfig() {
    const newTopics = Array.from(ui.guidedTopics);
    const guidedChanged = ui.guidedEnabled !== ui.lastSavedGuidedEnabled ||
      newTopics.length !== ui.lastSavedGuidedTopics.size ||
      newTopics.some(t => !ui.lastSavedGuidedTopics.has(t));

    void (async () => {
      await api('/ai/config', {
        method: 'POST',
        body: {
          platform: ui.currentPlatform,
          model: ui.currentModel,
          guidedReview: { enabled: ui.guidedEnabled, topics: newTopics },
        },
      });

      const newConfig = await api<{ keyConfigured: boolean }>('/ai/config');
      aiStore.actions.update({
        aiConfigured: newConfig.keyConfigured,
        guidedReviewEnabled: ui.guidedEnabled,
      });
      configData.guidedReview = { enabled: ui.guidedEnabled, topics: newTopics };

      if (guidedChanged && aiStore.state.value.aiConfigured) {
        invalidateAnalysisCache();
        invalidateGuidedAnalysis();
      }

      ui.lastSavedGuidedEnabled = ui.guidedEnabled;
      ui.lastSavedGuidedTopics = new Set(ui.guidedTopics);
    })();
  }

  function saveConfigDebounced() {
    if (configTimer) clearTimeout(configTimer);
    configTimer = setTimeout(saveConfig, SETTINGS_CONFIG_DEBOUNCE_MS);
  }

  function saveAppNameDebounced() {
    if (appNameTimer) clearTimeout(appNameTimer);
    appNameTimer = setTimeout(() => {
      const val = ui.appName.trim();
      if (val !== (projectSettings.appName ?? '')) {
        void api('/project-settings', { method: 'PATCH', body: { appName: val } });
        projectSettings.appName = val || undefined;
      }
    }, SETTINGS_APP_NAME_DEBOUNCE_MS);
  }

  function saveKey() {
    const keyInput = overlay.querySelector<HTMLInputElement>('#settings-key');
    if (keyInput === null || keyInput.value.trim() === '') return;
    const storageRadio = overlay.querySelector<HTMLInputElement>('input[name="key-storage"]:checked');
    const storage = storageRadio?.value ?? 'config';
    void (async () => {
      await api('/ai/key', {
        method: 'POST',
        body: { platform: ui.currentPlatform, key: keyInput.value.trim(), storage },
      });
      const newStatus = await api<KeyStatusResponse>('/ai/key-status');
      keyStatus.status = newStatus.status;
      const newConfig = await api<{ keyConfigured: boolean }>('/ai/config');
      aiStore.actions.update({ aiConfigured: newConfig.keyConfigured });
      renderContent();
    })();
  }

  function removeKey() {
    void (async () => {
      await api(`/ai/key?platform=${ui.currentPlatform}`, { method: 'DELETE' });
      const newStatus = await api<KeyStatusResponse>('/ai/key-status');
      keyStatus.status = newStatus.status;
      const newConfig = await api<{ keyConfigured: boolean }>('/ai/config');
      aiStore.actions.update({ aiConfigured: newConfig.keyConfigured });
      renderContent();
    })();
  }

  function toggleTopic(topic: string) {
    if (ui.guidedTopics.has(topic)) {
      ui.guidedTopics.delete(topic);
    } else {
      ui.guidedTopics.add(topic);
      if (topic === 'programming') {
        const hasAnyLang = [...ui.guidedTopics].some(t => ALL_LANG_KEYS.has(t));
        if (!hasAnyLang) {
          for (const key of ALL_LANG_KEYS) ui.guidedTopics.add(key);
          ui.showMoreLangs = true;
        }
      }
    }
    saveConfigDebounced();
  }

  function buildContext(): TabContext {
    return {
      keyStatus,
      modelsData,
      themesData,
      projectSettings,
      channelState,
      isTauri: ui.isTauri,
      currentPlatform: ui.currentPlatform,
      currentModel: ui.currentModel,
      guidedEnabled: ui.guidedEnabled,
      guidedTopics: ui.guidedTopics,
      showMoreLangs: ui.showMoreLangs,
      appName: ui.appName,
      activeThemeId: ui.activeThemeId,
      setCurrentPlatform: (platform) => {
        ui.currentPlatform = platform;
        const models = modelsData.models[platform] ?? [];
        const defaultModel = models.find(m => m.isDefault);
        ui.currentModel = defaultModel ? defaultModel.id : (models[0]?.id ?? '');
      },
      setCurrentModel: (model) => { ui.currentModel = model; },
      setGuidedEnabled: (enabled) => { ui.guidedEnabled = enabled; },
      setShowMoreLangs: (b) => { ui.showMoreLangs = b; },
      setAppName: (name) => { ui.appName = name; },
      setActiveThemeId: (id) => { ui.activeThemeId = id; },
      setChannelEnabled: (enabled) => { channelState.enabled = enabled; },
      saveConfig,
      saveKey,
      removeKey,
      toggleTopic,
      saveAppNameDebounced,
      switchTheme: (id) => void switchTheme(id),
      showThemeManager,
      refreshThemes: () => api<ThemesResponse>('/themes').then(updated => {
        themesData.themes = updated.themes;
        themesData.activeId = updated.activeId;
        return updated;
      }),
      renderContent,
    };
  }

  function activeTabs(ctx: TabContext): Tab[] {
    return TABS.filter(t => t.enabled === undefined || t.enabled(ctx));
  }

  function renderContent() {
    const modalEl = overlay.querySelector('.modal');
    if (modalEl === null) return;

    const ctx = buildContext();
    const visible = activeTabs(ctx);
    if (!visible.some(t => t.id === ui.activeTab)) {
      ui.activeTab = visible[0]?.id ?? 'general';
    }

    modalEl.innerHTML = renderShell(visible, ui.activeTab, ctx).toString();
    bindModalEvents(ctx, visible);
  }

  function bindModalEvents(ctx: TabContext, visible: Tab[]) {
    overlay.querySelectorAll('.settings-tab').forEach(tabEl => {
      tabEl.addEventListener('click', () => {
        const dataTab = tabEl.getAttribute('data-tab');
        const fallback = visible[0]?.id ?? 'general';
        ui.activeTab = dataTab ?? fallback;
        renderContent();
      });
    });

    overlay.querySelector('#settings-close')?.addEventListener('click', closeDialog);

    for (const tab of visible) {
      tab.bind(overlay, ctx);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });
  }

  document.addEventListener('keydown', handleEscape);
  overlay.innerHTML = (<div className="modal settings-dialog"></div>).toString();
  document.body.appendChild(overlay);
  renderContent();
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
