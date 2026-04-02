import type { SafeHtml } from '../../jsx-runtime.js';
import { api } from '../api.js';
import { toElement } from '../dom.js';
import { invalidateGuidedAnalysis } from '../guided.js';
import { invalidateAnalysisCache } from '../sidebar/sortMode.js';
import { state } from '../state.js';
import { getTauriInvoke, showUpdateBanner } from '../tauri.js';
import { switchTheme } from '../themes.js';
import { showThemeManager } from './themeManager.js';
import { renderExperimentalTab, bindExperimentalTabEvents } from './experimentalTab.js';
import { renderGeneralTab, bindGeneralTabEvents } from './generalTab.js';
import { renderProfileTab, bindProfileTabEvents, ALL_LANG_KEYS } from './profileTab.js';

import { IconSliders, IconFlask, IconDownload, IconUser } from '../../icons.js';

interface KeyStatusResponse {
  status: Record<string, { configured: boolean; source: string | null }>;
  keychainAvailable: boolean;
  keychainLabel: string;
}

interface ModelsResponse {
  platforms: Record<string, string>;
  models: Record<string, Array<{ id: string; name: string; isDefault: boolean }>>;
}

interface ConfigResponse {
  platform: string;
  model: string;
  keyConfigured: boolean;
  keySource: string | null;
  guidedReview: { enabled: boolean; topics: string[] };
}

interface ProjectSettingsResponse {
  appName?: string;
}

interface ThemesResponse {
  themes: Array<{ id: string; name: string; builtIn: boolean }>;
  activeId: string;
}

export function showSettingsDialog(onClose?: () => void) {
  void (async () => {
    const [keyStatus, modelsData, configData, projectSettings, themesData] = await Promise.all([
      api<KeyStatusResponse>('/ai/key-status'),
      api<ModelsResponse>('/ai/models'),
      api<ConfigResponse>('/ai/config'),
      api<ProjectSettingsResponse>('/project-settings'),
      api<ThemesResponse>('/themes'),
    ]);

    renderSettingsModal(keyStatus, modelsData, configData, projectSettings, themesData, onClose);
  })();
}

function renderSettingsModal(
  keyStatus: KeyStatusResponse,
  modelsData: ModelsResponse,
  configData: ConfigResponse,
  projectSettings: ProjectSettingsResponse,
  themesData: ThemesResponse,
  onClose?: () => void,
) {
  const overlay = toElement(<div className="modal-overlay"></div>);

  let currentPlatform = configData.platform;
  let currentModel = configData.model;
  let guidedEnabled = configData.guidedReview.enabled;
  const guidedTopics = new Set(configData.guidedReview.topics);
  let showMoreLangs = false;
  let appName = projectSettings.appName ?? '';
  const isTauri = !!(window as unknown as Record<string, unknown>).__TAURI__;
  let activeTab = 'general';
  let activeThemeId = themesData.activeId;

  // Track last-saved guided review state for cache invalidation
  let lastSavedGuidedEnabled = guidedEnabled;
  let lastSavedGuidedTopics = new Set(guidedTopics);

  // Debounce timers
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
    const newTopics = Array.from(guidedTopics);
    const guidedChanged = guidedEnabled !== lastSavedGuidedEnabled ||
      newTopics.length !== lastSavedGuidedTopics.size ||
      newTopics.some(t => !lastSavedGuidedTopics.has(t));

    void (async () => {
      await api('/ai/config', {
        method: 'POST',
        body: {
          platform: currentPlatform,
          model: currentModel,
          guidedReview: { enabled: guidedEnabled, topics: newTopics },
        },
      });

      const newConfig = await api<{ keyConfigured: boolean }>('/ai/config');
      state.aiConfigured = newConfig.keyConfigured;
      state.guidedReviewEnabled = guidedEnabled;
      configData.guidedReview = { enabled: guidedEnabled, topics: newTopics };

      if (guidedChanged && state.aiConfigured) {
        invalidateAnalysisCache();
        invalidateGuidedAnalysis();
      }

      lastSavedGuidedEnabled = guidedEnabled;
      lastSavedGuidedTopics = new Set(guidedTopics);
    })();
  }

  function saveConfigDebounced() {
    if (configTimer) clearTimeout(configTimer);
    configTimer = setTimeout(saveConfig, 300);
  }

  function saveAppNameDebounced() {
    if (appNameTimer) clearTimeout(appNameTimer);
    appNameTimer = setTimeout(() => {
      const val = appName.trim();
      if (val !== (projectSettings.appName ?? '')) {
        void api('/project-settings', { method: 'PATCH', body: { appName: val } });
        projectSettings.appName = val || undefined;
      }
    }, 500);
  }

  function getKeyInfo(platform: string): { configured: boolean; source: string | null } {
    return keyStatus.status[platform] ?? { configured: false, source: null };
  }

  function saveKey() {
    const keyInput = overlay.querySelector<HTMLInputElement>('#settings-key');
    if (keyInput === null || keyInput.value.trim() === '') return;
    const storageRadio = overlay.querySelector<HTMLInputElement>('input[name="key-storage"]:checked');
    const storage = storageRadio?.value ?? 'config';
    void (async () => {
      await api('/ai/key', {
        method: 'POST',
        body: { platform: currentPlatform, key: keyInput.value.trim(), storage },
      });
      const newStatus = await api<KeyStatusResponse>('/ai/key-status');
      keyStatus.status = newStatus.status;
      const newConfig = await api<{ keyConfigured: boolean }>('/ai/config');
      state.aiConfigured = newConfig.keyConfigured;
      renderContent();
    })();
  }

  function removeKey() {
    void (async () => {
      await api(`/ai/key?platform=${currentPlatform}`, { method: 'DELETE' });
      const newStatus = await api<KeyStatusResponse>('/ai/key-status');
      keyStatus.status = newStatus.status;
      const newConfig = await api<{ keyConfigured: boolean }>('/ai/config');
      state.aiConfigured = newConfig.keyConfigured;
      renderContent();
    })();
  }

  function toggleTopic(topic: string) {
    if (guidedTopics.has(topic)) {
      guidedTopics.delete(topic);
    } else {
      guidedTopics.add(topic);
      if (topic === 'programming') {
        const hasAnyLang = [...guidedTopics].some(t => ALL_LANG_KEYS.has(t));
        if (!hasAnyLang) {
          for (const key of ALL_LANG_KEYS) guidedTopics.add(key);
          showMoreLangs = true;
        }
      }
    }
    saveConfigDebounced();
  }

  function renderContent() {
    const modalEl = overlay.querySelector('.modal');
    if (modalEl === null) return;

    modalEl.innerHTML = renderSettingsShell({
      activeTab,
      isTauri,
      generalContent: renderGeneralTab({ themesData, activeThemeId, appName, isTauri }),
      profileContent: renderProfileTab({ guidedTopics, showMoreLangs }),
      experimentalContent: renderExperimentalTab({
        platforms: modelsData.platforms,
        currentPlatform,
        currentModel,
        platformModels: modelsData.models[currentPlatform] ?? [],
        keyInfo: getKeyInfo(currentPlatform),
        keychainAvailable: keyStatus.keychainAvailable,
        keychainLabel: keyStatus.keychainLabel,
        guidedEnabled,
      }),
    }).toString();

    bindModalEvents();
  }

  function bindModalEvents() {
    // Tab switching
    overlay.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeTab = (tab as HTMLElement).dataset.tab ?? 'experimental';
        renderContent();
      });
    });

    // Close button
    overlay.querySelector('#settings-close')?.addEventListener('click', closeDialog);

    // Check for Updates button (Tauri only)
    const checkUpdatesBtn = overlay.querySelector<HTMLButtonElement>('#check-updates-btn');
    const checkUpdatesStatus = overlay.querySelector<HTMLElement>('#check-updates-status');
    if (checkUpdatesBtn !== null && checkUpdatesStatus !== null) {
      checkUpdatesBtn.addEventListener('click', async () => {
        const invoke = getTauriInvoke();
        if (!invoke) return;
        checkUpdatesBtn.disabled = true;
        checkUpdatesBtn.textContent = 'Checking...';
        checkUpdatesStatus.textContent = '';
        try {
          const version = (await invoke('check_for_update')) as string | null;
          if (version) {
            checkUpdatesStatus.textContent = `Update available: v${version}`;
            showUpdateBanner(version);
          } else {
            checkUpdatesStatus.textContent = 'Your software is up to date.';
          }
        } catch {
          checkUpdatesStatus.textContent = 'Could not check for updates.';
        }
        checkUpdatesBtn.textContent = 'Check for Updates';
        checkUpdatesBtn.disabled = false;
      });
    }

    // General tab events
    bindGeneralTabEvents(overlay, {
      switchTheme: (id) => void switchTheme(id),
      showThemeManager,
      saveAppNameDebounced,
      refreshThemes: () => api<ThemesResponse>('/themes').then(updated => {
        themesData.themes = updated.themes;
        themesData.activeId = updated.activeId;
        return updated;
      }),
      setAppName: (name) => { appName = name; },
      setActiveThemeId: (id) => { activeThemeId = id; },
      renderContent,
    });

    // Profile tab events
    bindProfileTabEvents(overlay, {
      toggleTopic,
      setShowMoreLangs: (val) => { showMoreLangs = val; },
      renderContent,
    });

    // Experimental tab events
    bindExperimentalTabEvents(overlay, {
      switchPlatform: (platform) => {
        currentPlatform = platform;
        const models = modelsData.models[currentPlatform] ?? [];
        const defaultModel = models.find(m => m.isDefault);
        currentModel = defaultModel ? defaultModel.id : (models[0]?.id ?? '');
      },
      setModel: (model) => { currentModel = model; },
      saveConfig,
      saveKey,
      removeKey,
      toggleGuided: (enabled) => { guidedEnabled = enabled; },
      renderContent,
    });

    // Click outside to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });
  }

  document.addEventListener('keydown', handleEscape);
  overlay.innerHTML = (<div className="modal settings-dialog"></div>).toString();
  document.body.appendChild(overlay);
  renderContent();
}

interface ShellData {
  activeTab: string;
  isTauri: boolean;
  generalContent: SafeHtml;
  profileContent: SafeHtml;
  experimentalContent: SafeHtml;
}

function renderSettingsShell(data: ShellData): SafeHtml {
  const { activeTab, isTauri, generalContent, profileContent, experimentalContent } = data;
  return (
    <>
      <div className="settings-header">
        <h3>Settings</h3>
        <button className="settings-close" id="settings-close">&times;</button>
      </div>

      <div className="settings-tabs">
        <button className={`settings-tab${activeTab === 'general' ? ' active' : ''}`} data-tab="general">
          <IconSliders />
          <span>General</span>
        </button>
        <button className={`settings-tab${activeTab === 'profile' ? ' active' : ''}`} data-tab="profile">
          <IconUser />
          <span>Profile</span>
        </button>
        <button className={`settings-tab${activeTab === 'experimental' ? ' active' : ''}`} data-tab="experimental">
          <IconFlask />
          <span>Experimental</span>
        </button>
        {isTauri && (
          <button className={`settings-tab${activeTab === 'updates' ? ' active' : ''}`} data-tab="updates">
            <IconDownload />
            <span>Updates</span>
          </button>
        )}
      </div>

      <div className="settings-body">
        <div className={`settings-tab-panel${activeTab === 'general' ? ' active' : ''}`} data-panel="general">
          {generalContent}
        </div>

        <div className={`settings-tab-panel${activeTab === 'profile' ? ' active' : ''}`} data-panel="profile">
          {profileContent}
        </div>

        <div className={`settings-tab-panel${activeTab === 'experimental' ? ' active' : ''}`} data-panel="experimental">
          {experimentalContent}
        </div>

        {isTauri && (
          <div className={`settings-tab-panel${activeTab === 'updates' ? ' active' : ''}`} data-panel="updates">
            <div className="settings-section">
              <div className="settings-section-header">
                <span className="settings-heading">Software Updates</span>
              </div>
              <p className="settings-disclaimer">Check for new versions of the Glassbox desktop app.</p>
              <button className="btn btn-sm" id="check-updates-btn">Check for Updates</button>
              <p className="settings-hint" id="check-updates-status"></p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
