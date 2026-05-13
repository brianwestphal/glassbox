import type { SafeHtml } from 'kerfjs';
import { delegate, mount, signal } from 'kerfjs';

import { api } from '../api.js';
import { toElement } from '../dom.js';
import { invalidateGuidedAnalysis } from '../guided.js';
import { triggerShare } from '../share.js';
import { invalidateAnalysisCache } from '../sidebar/sortMode.js';
import { aiStore } from '../stores/index.js';
import { getTauriInvoke, showUpdateBanner } from '../tauri.js';
import { switchTheme } from '../themes.js';
import { SETTINGS_APP_NAME_DEBOUNCE_MS, SETTINGS_CONFIG_DEBOUNCE_MS, TOAST_DURATION_MS } from '../timing.js';
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
): void {
  const isTauri = (window as unknown as Record<string, unknown>).__TAURI__ !== undefined;

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
  let lastSavedGuidedEnabled = configData.guidedReview.enabled;
  let lastSavedGuidedTopics = new Set(configData.guidedReview.topics);

  const overlay = toElement(<div className="modal-overlay"><div className="modal settings-dialog"></div></div>);
  const modalEl = overlay.querySelector<HTMLElement>('.modal');
  if (modalEl === null) return;

  function setUi(partial: Partial<SettingsUIState>): void {
    ui.value = { ...ui.value, ...partial };
  }

  let configTimer: ReturnType<typeof setTimeout> | null = null;
  let appNameTimer: ReturnType<typeof setTimeout> | null = null;
  let disposeMount: (() => void) | null = null;

  function closeDialog(): void {
    if (configTimer) clearTimeout(configTimer);
    if (appNameTimer) clearTimeout(appNameTimer);
    document.removeEventListener('keydown', handleEscape);
    if (disposeMount !== null) disposeMount();
    overlay.remove();
    if (onClose !== undefined) onClose();
  }

  function handleEscape(e: KeyboardEvent): void {
    if (e.key === 'Escape') closeDialog();
  }

  function saveConfig(): void {
    const cur = ui.value;
    const newTopics = Array.from(cur.guidedTopics);
    const guidedChanged = cur.guidedEnabled !== lastSavedGuidedEnabled
      || newTopics.length !== lastSavedGuidedTopics.size
      || newTopics.some(t => !lastSavedGuidedTopics.has(t));

    void (async () => {
      await api('/ai/config', {
        method: 'POST',
        body: {
          platform: cur.currentPlatform,
          model: cur.currentModel,
          guidedReview: { enabled: cur.guidedEnabled, topics: newTopics },
        },
      });

      const newConfig = await api<{ keyConfigured: boolean }>('/ai/config');
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
        void api('/project-settings', { method: 'PATCH', body: { appName: val } });
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
      await api('/ai/key', {
        method: 'POST',
        body: { platform: ui.value.currentPlatform, key: keyInput.value.trim(), storage },
      });
      const newStatus = await api<KeyStatusResponse>('/ai/key-status');
      keyStatus.status = newStatus.status;
      const newConfig = await api<{ keyConfigured: boolean }>('/ai/config');
      aiStore.actions.update({ aiConfigured: newConfig.keyConfigured });
      ui.value = { ...ui.value }; // force re-render (server data mutated)
    })();
  }

  function removeKey(): void {
    void (async () => {
      await api(`/ai/key?platform=${ui.value.currentPlatform}`, { method: 'DELETE' });
      const newStatus = await api<KeyStatusResponse>('/ai/key-status');
      keyStatus.status = newStatus.status;
      const newConfig = await api<{ keyConfigured: boolean }>('/ai/config');
      aiStore.actions.update({ aiConfigured: newConfig.keyConfigured });
      ui.value = { ...ui.value };
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

  function buildContext(): TabContext {
    const cur = ui.value;
    return {
      keyStatus, modelsData, themesData, projectSettings, channelState,
      isTauri,
      currentPlatform: cur.currentPlatform,
      currentModel: cur.currentModel,
      guidedEnabled: cur.guidedEnabled,
      guidedTopics: cur.guidedTopics,
      showMoreLangs: cur.showMoreLangs,
      appName: cur.appName,
      activeThemeId: cur.activeThemeId,
      // No-op mutators kept on TabContext for backwards-compat with the Tab
      // interface; all interactions now flow through the delegated handlers
      // registered below, which call setUi() directly.
      setCurrentPlatform: () => { /* unused — see [data-platform] delegate */ },
      setCurrentModel: () => { /* unused */ },
      setGuidedEnabled: () => { /* unused */ },
      setShowMoreLangs: () => { /* unused */ },
      setAppName: () => { /* unused */ },
      setActiveThemeId: () => { /* unused */ },
      setChannelEnabled: () => { /* unused */ },
      saveConfig, saveKey, removeKey, toggleTopic, saveAppNameDebounced,
      switchTheme: (id: string) => void switchTheme(id),
      showThemeManager,
      refreshThemes: () => api<ThemesResponse>('/themes').then(updated => {
        themesData.themes = updated.themes;
        themesData.activeId = updated.activeId;
        return updated;
      }),
      renderContent: () => { ui.value = { ...ui.value }; },
    };
  }

  // Mount the reactive shell.
  disposeMount = mount(modalEl, () => {
    const ctx = buildContext();
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

  // Delegated handlers — single registration per concern, fires for every
  // re-render automatically.

  delegate(overlay, 'click', '#settings-close', closeDialog);
  delegate(overlay, 'click', '[data-tab]', (_e, btn) => {
    const t = (btn as HTMLElement).dataset.tab;
    if (t !== undefined) setUi({ activeTab: t });
  });

  // General tab
  delegate(overlay, 'change', '#settings-theme', (_e, sel) => {
    const id = (sel as HTMLSelectElement).value;
    setUi({ activeThemeId: id });
    void switchTheme(id);
  });
  delegate(overlay, 'click', '#manage-themes-btn', () => {
    showThemeManager(() => {
      void (async () => {
        const updated = await api<ThemesResponse>('/themes');
        themesData.themes = updated.themes;
        themesData.activeId = updated.activeId;
        setUi({ activeThemeId: updated.activeId });
      })();
    });
  });
  delegate(overlay, 'click', '#settings-share-link', (e) => {
    e.preventDefault();
    void triggerShare();
  });
  delegate(overlay, 'input', '#settings-app-name', (_e, input) => {
    setUi({ appName: (input as HTMLInputElement).value });
    saveAppNameDebounced();
  });

  // Profile tab
  delegate(overlay, 'click', '.settings-tag', (_e, tag) => {
    const topic = (tag as HTMLElement).dataset.topic;
    if (topic !== undefined) toggleTopic(topic);
  });
  delegate(overlay, 'click', '#show-more-langs', () => { setUi({ showMoreLangs: true }); });

  // Experimental tab
  delegate(overlay, 'click', '.settings-platform-control [data-platform]', (_e, btn) => {
    const platform = (btn as HTMLElement).dataset.platform;
    if (platform === undefined) return;
    const models = modelsData.models[platform] ?? [];
    const defaultModel = models.find(m => m.isDefault);
    const newModel = defaultModel ? defaultModel.id : (models[0]?.id ?? '');
    setUi({ currentPlatform: platform, currentModel: newModel });
    saveConfig();
  });
  delegate(overlay, 'change', '#settings-model', (_e, sel) => {
    setUi({ currentModel: (sel as HTMLSelectElement).value });
    saveConfig();
  });
  delegate(overlay, 'click', '#remove-key', removeKey);
  delegate(overlay, 'click', '#save-key-btn', saveKey);
  delegate(overlay, 'keydown', '#settings-key', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter') { ke.preventDefault(); saveKey(); }
  });
  delegate(overlay, 'change', '#settings-guided-enabled', (_e, cb) => {
    setUi({ guidedEnabled: (cb as HTMLInputElement).checked });
    saveConfig();
  });
  delegate(overlay, 'change', '#settings-channel-enabled', (_e, cb) => {
    const enabled = (cb as HTMLInputElement).checked;
    channelState.enabled = enabled;
    void api(enabled ? '/channel/enable' : '/channel/disable', { method: 'POST' });
    ui.value = { ...ui.value }; // re-render reflects channelState change
  });
  delegate(overlay, 'click', '#channel-copy-btn', (_e, btn) => {
    void navigator.clipboard.writeText('claude --dangerously-load-development-channels server:glassbox-channel');
    const el = btn as HTMLElement;
    el.textContent = 'Copied!';
    setTimeout(() => { el.textContent = 'Copy'; }, TOAST_DURATION_MS);
  });

  // Updates tab
  delegate(overlay, 'click', '#check-updates-btn', (_e, btn) => {
    void handleCheckUpdates(btn as HTMLButtonElement, overlay);
  });

  // Click outside (on the dimmed overlay background) closes the dialog. Bound
  // directly on the overlay element — it's the modal root, not inside a
  // mount() tree, so a direct listener survives.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });

  document.addEventListener('keydown', handleEscape);
  document.body.appendChild(overlay);
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
