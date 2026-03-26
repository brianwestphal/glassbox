import type { SafeHtml } from '../../jsx-runtime.js';
import { api } from '../api.js';
import { toElement } from '../dom.js';
import { invalidateGuidedAnalysis } from '../guided.js';
import { invalidateAnalysisCache } from '../sidebar/sortMode.js';
import { state } from '../state.js';
import { getTauriInvoke, showUpdateBanner } from '../tauri.js';

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

import { IconCheck, IconSliders, IconFlask, IconDownload } from '../../icons.js';

const TOP_LANGUAGES: Array<[string, string]> = [
  ['javascript', 'JavaScript'], ['python', 'Python'], ['typescript', 'TypeScript'],
  ['java', 'Java'], ['csharp', 'C#'], ['cpp', 'C++'],
  ['go', 'Go'], ['rust', 'Rust'], ['php', 'PHP'], ['swift', 'Swift'],
];

const MORE_LANGUAGES: Array<[string, string]> = [
  ['c', 'C'], ['ruby', 'Ruby'], ['kotlin', 'Kotlin'], ['scala', 'Scala'],
  ['dart', 'Dart'], ['objectivec', 'Objective-C'], ['elixir', 'Elixir'],
  ['haskell', 'Haskell'], ['clojure', 'Clojure'], ['bash', 'Shell'],
  ['perl', 'Perl'], ['lua', 'Lua'], ['r', 'R'], ['ocaml', 'OCaml'],
  ['zig', 'Zig'], ['nim', 'Nim'], ['erlang', 'Erlang'], ['groovy', 'Groovy'],
];

const ALL_LANG_KEYS = new Set([...TOP_LANGUAGES, ...MORE_LANGUAGES].map(([k]) => k));

interface ProjectSettingsResponse {
  appName?: string;
}

export function showSettingsDialog(onClose?: () => void) {
  void (async () => {
    const [keyStatus, modelsData, configData, projectSettings] = await Promise.all([
      api<KeyStatusResponse>('/ai/key-status'),
      api<ModelsResponse>('/ai/models'),
      api<ConfigResponse>('/ai/config'),
      api<ProjectSettingsResponse>('/project-settings'),
    ]);

    renderSettingsModal(keyStatus, modelsData, configData, projectSettings, onClose);
  })();
}

function renderSettingsModal(
  keyStatus: KeyStatusResponse,
  modelsData: ModelsResponse,
  configData: ConfigResponse,
  projectSettings: ProjectSettingsResponse,
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
  let activeTab = isTauri ? 'general' : 'experimental';

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

  function renderPlatformModels(platform: string): SafeHtml[] {
    const models = modelsData.models[platform] ?? [];
    return models.map(m =>
      <option value={m.id} selected={m.id === currentModel}>{m.name}{m.isDefault ? ' (recommended)' : ''}</option>
    );
  }

  function keyStatusHtml(platform: string): SafeHtml {
    const info = getKeyInfo(platform);
    if (info.configured) {
      return (
        <div className="settings-key-status settings-key-configured">
          <IconCheck />
          <span>{'Configured via ' + (info.source ?? 'unknown')}</span>
          {info.source !== 'env' && (
            <button className="btn btn-xs btn-danger" id="remove-key">Remove</button>
          )}
        </div>
      );
    }
    return (
      <div className="settings-key-status">
        <span className="settings-key-missing">Not configured</span>
      </div>
    );
  }

  function renderTag(key: string, label: string): SafeHtml {
    const active = guidedTopics.has(key);
    return <button className={`settings-tag${active ? ' active' : ''}`} data-topic={key}>{label}</button>;
  }

  function renderContent() {
    const info = getKeyInfo(currentPlatform);
    const showInput = !info.configured;

    const modalEl = overlay.querySelector('.modal');
    if (modalEl === null) return;

    const langTags = TOP_LANGUAGES.map(([k, n]) => renderTag(k, n));
    const moreLangTags = MORE_LANGUAGES.map(([k, n]) => renderTag(k, n));

    modalEl.innerHTML = (
      <>
        <div className="settings-header">
          <h3>Settings</h3>
          <button className="settings-close" id="settings-close">&times;</button>
        </div>

        <div className="settings-tabs">
          {isTauri && (
            <button className={`settings-tab${activeTab === 'general' ? ' active' : ''}`} data-tab="general">
              <IconSliders />
              <span>General</span>
            </button>
          )}
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
          {/* General tab (Tauri only) */}
          {isTauri && (
            <div className={`settings-tab-panel${activeTab === 'general' ? ' active' : ''}`} data-panel="general">
              <div className="settings-section">
                <label className="settings-label">App Name</label>
                <input type="text" className="settings-input" id="settings-app-name" value={appName} placeholder="Glassbox — project-name" />
                <p className="settings-hint">Custom window title for the desktop app. Leave blank for the default.</p>
              </div>
            </div>
          )}

          {/* Experimental tab */}
          <div className={`settings-tab-panel${activeTab === 'experimental' ? ' active' : ''}`} data-panel="experimental">
            <div className="settings-section-header">
              <span className="settings-heading">AI</span>
              <span className="settings-beta-badge">Beta</span>
            </div>
            <p className="settings-disclaimer">
              AI features are in early beta and provided for evaluation purposes only, without warranty of any kind.
            </p>

            <div className="settings-section">
              <label className="settings-label">Platform</label>
              <div className="segmented-control settings-platform-control">
                {Object.entries(modelsData.platforms).map(([key, name]) => (
                  <button className={`segment${key === currentPlatform ? ' active' : ''}`}
                    data-platform={key}>{name}</button>
                ))}
              </div>
            </div>

            <div className="settings-section">
              <label className="settings-label">Model</label>
              <select className="settings-select" id="settings-model">{renderPlatformModels(currentPlatform)}</select>
            </div>

            <div className="settings-section">
              <label className="settings-label">API Key</label>
              {keyStatusHtml(currentPlatform)}
              {showInput && (
                <div className="settings-key-input-group">
                  <div className="settings-key-row">
                    <input type="password" className="settings-input" id="settings-key"
                      placeholder="Enter API key..." autocomplete="off" />
                    <button className="btn btn-xs btn-primary" id="save-key-btn">Save Key</button>
                  </div>
                  {keyStatus.keychainAvailable ? (
                    <div className="settings-storage-options">
                      <label className="settings-radio">
                        <input type="radio" name="key-storage" value="keychain" checked />
                        <span>{'Store in ' + keyStatus.keychainLabel}</span>
                      </label>
                      <label className="settings-radio">
                        <input type="radio" name="key-storage" value="config" />
                        <span>Store in config file</span>
                      </label>
                    </div>
                  ) : (
                    <div className="settings-storage-options">
                      <label className="settings-radio">
                        <input type="radio" name="key-storage" value="config" checked />
                        <span>Store in ~/.glassbox/config.json</span>
                      </label>
                      <p className="settings-warning">Key will be stored with basic encoding (not encrypted). Only use for local development.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="settings-divider"></div>

            <div className="settings-section-header">
              <span className="settings-heading">Guided Review</span>
              <span className="settings-beta-badge">Beta</span>
            </div>
            <p className="settings-disclaimer">
              Get AI explanations tailored to your experience level.
            </p>

            <div className="settings-section">
              <label className="settings-checkbox"><input type="checkbox" id="settings-guided-enabled" checked={guidedEnabled} /><span>Enable guided review</span></label>
            </div>

            {guidedEnabled && (
              <div className="settings-guided-topics">
                <label className="settings-label">I'm new to...</label>
                <div className="settings-tags">
                  {renderTag('programming', 'Programming')}
                  {renderTag('codebase', 'This codebase')}
                </div>

                <label className="settings-label settings-label-spaced">I'm new to these languages</label>
                <div className="settings-tags">
                  {langTags}
                </div>

                {!showMoreLangs && (
                  <button className="settings-more-toggle" id="show-more-langs">More languages...</button>
                )}
                {showMoreLangs && (
                  <div className="settings-tags settings-tags-more">
                    {moreLangTags}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Updates tab (Tauri only) */}
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
    ).toString();

    bindModalEvents();
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

    // Check for Updates button
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

    // Platform switching — save immediately
    overlay.querySelectorAll('.settings-platform-control .segment').forEach(btn => {
      btn.addEventListener('click', () => {
        currentPlatform = (btn as HTMLElement).dataset.platform ?? currentPlatform;
        const models = modelsData.models[currentPlatform] ?? [];
        const defaultModel = models.find(m => m.isDefault);
        currentModel = defaultModel ? defaultModel.id : (models[0]?.id ?? '');
        saveConfig();
        renderContent();
      });
    });

    // Model selection — save immediately
    const modelSelect = overlay.querySelector<HTMLSelectElement>('#settings-model');
    if (modelSelect !== null) {
      modelSelect.addEventListener('change', () => {
        currentModel = modelSelect.value;
        saveConfig();
      });
    }

    // Remove key
    const removeBtn = overlay.querySelector('#remove-key');
    if (removeBtn !== null) {
      removeBtn.addEventListener('click', () => {
        void (async () => {
          await api(`/ai/key?platform=${currentPlatform}`, { method: 'DELETE' });
          const newStatus = await api<KeyStatusResponse>('/ai/key-status');
          keyStatus.status = newStatus.status;
          const newConfig = await api<{ keyConfigured: boolean }>('/ai/config');
          state.aiConfigured = newConfig.keyConfigured;
          renderContent();
        })();
      });
    }

    // Save key button
    overlay.querySelector('#save-key-btn')?.addEventListener('click', saveKey);

    // Save key on Enter
    const keyInput = overlay.querySelector<HTMLInputElement>('#settings-key');
    if (keyInput !== null) {
      keyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveKey(); }
      });
    }

    // Guided review checkbox — save immediately
    const guidedCheckbox = overlay.querySelector<HTMLInputElement>('#settings-guided-enabled');
    if (guidedCheckbox !== null) {
      guidedCheckbox.addEventListener('change', () => {
        guidedEnabled = guidedCheckbox.checked;
        saveConfig();
        renderContent();
      });
    }

    // Topic tags — debounced save
    overlay.querySelectorAll('.settings-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const topic = (tag as HTMLElement).dataset.topic;
        if (topic !== undefined) {
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
          renderContent();
        }
      });
    });

    // More languages toggle
    const moreBtn = overlay.querySelector('#show-more-langs');
    if (moreBtn !== null) {
      moreBtn.addEventListener('click', () => {
        showMoreLangs = true;
        renderContent();
      });
    }

    // App name input — debounced save
    const appNameInput = overlay.querySelector<HTMLInputElement>('#settings-app-name');
    if (appNameInput !== null) {
      appNameInput.addEventListener('input', () => {
        appName = appNameInput.value;
        saveAppNameDebounced();
      });
    }

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
