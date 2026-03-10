import { raw } from '../../jsx-runtime.js';
import { api } from '../api.js';
import { toElement } from '../dom.js';
import { invalidateGuidedAnalysis } from '../guided.js';
import { invalidateAnalysisCache } from '../sidebar/sortMode.js';
import { state } from '../state.js';

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

const ICON_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

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

export function showSettingsDialog(onSave?: () => void) {
  void (async () => {
    const [keyStatus, modelsData, configData] = await Promise.all([
      api<KeyStatusResponse>('/ai/key-status'),
      api<ModelsResponse>('/ai/models'),
      api<ConfigResponse>('/ai/config'),
    ]);

    renderSettingsModal(keyStatus, modelsData, configData, onSave);
  })();
}

function renderSettingsModal(
  keyStatus: KeyStatusResponse,
  modelsData: ModelsResponse,
  configData: ConfigResponse,
  onSave?: () => void,
) {
  const overlay = toElement(<div className="modal-overlay"></div>);

  let currentPlatform = configData.platform;
  let currentModel = configData.model;
  let guidedEnabled = configData.guidedReview.enabled;
  const guidedTopics = new Set(configData.guidedReview.topics);
  let showMoreLangs = false;

  function getKeyInfo(platform: string): { configured: boolean; source: string | null } {
    return keyStatus.status[platform] ?? { configured: false, source: null };
  }

  function renderPlatformModels(platform: string): string {
    const models = modelsData.models[platform] ?? [];
    return models.map(m =>
      `<option value="${m.id}"${m.id === currentModel ? ' selected' : ''}>${m.name}${m.isDefault ? ' (recommended)' : ''}</option>`
    ).join('');
  }

  function keyStatusHtml(platform: string): string {
    const info = getKeyInfo(platform);
    if (info.configured) {
      return (
        <div className="settings-key-status settings-key-configured">
          {raw(ICON_CHECK)}
          <span>{'Configured via ' + (info.source ?? 'unknown')}</span>
          {info.source !== 'env' && (
            <button className="btn btn-xs btn-danger" id="remove-key">Remove</button>
          )}
        </div>
      ).toString();
    }
    return (
      <div className="settings-key-status">
        <span className="settings-key-missing">Not configured</span>
      </div>
    ).toString();
  }

  function renderTag(key: string, label: string): string {
    const active = guidedTopics.has(key);
    return `<button class="settings-tag${active ? ' active' : ''}" data-topic="${key}">${label}</button>`;
  }

  function renderContent() {
    const info = getKeyInfo(currentPlatform);
    const showInput = !info.configured;

    const modalEl = overlay.querySelector('.modal');
    if (modalEl === null) return;

    const langTags = TOP_LANGUAGES.map(([k, n]) => renderTag(k, n)).join('');
    const moreLangTags = MORE_LANGUAGES.map(([k, n]) => renderTag(k, n)).join('');

    modalEl.innerHTML = (
      <>
        <h3>Settings</h3>

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
          {raw(`<select class="settings-select" id="settings-model">${renderPlatformModels(currentPlatform)}</select>`)}
        </div>

        <div className="settings-section">
          <label className="settings-label">API Key</label>
          {raw(keyStatusHtml(currentPlatform))}
          {showInput && (
            <div className="settings-key-input-group">
              <input type="password" className="settings-input" id="settings-key"
                placeholder="Enter API key..." autocomplete="off" />
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
          {raw(`<label class="settings-checkbox"><input type="checkbox" id="settings-guided-enabled" ${guidedEnabled ? 'checked' : ''} /><span>Enable guided review</span></label>`)}
        </div>

        {guidedEnabled && (
          <div className="settings-guided-topics">
            <label className="settings-label">I'm new to...</label>
            <div className="settings-tags">
              {raw(renderTag('programming', 'Programming'))}
              {raw(renderTag('codebase', 'This codebase'))}
            </div>

            <label className="settings-label settings-label-spaced">I'm new to these languages</label>
            <div className="settings-tags">
              {raw(langTags)}
            </div>

            {!showMoreLangs && (
              <button className="settings-more-toggle" id="show-more-langs">More languages...</button>
            )}
            {showMoreLangs && (
              <div className="settings-tags settings-tags-more">
                {raw(moreLangTags)}
              </div>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-sm modal-cancel">Cancel</button>
          <button className="btn btn-sm btn-primary" id="settings-save">Save</button>
        </div>
      </>
    ).toString();

    bindModalEvents();
  }

  function bindModalEvents() {
    // Platform switching
    overlay.querySelectorAll('.settings-platform-control .segment').forEach(btn => {
      btn.addEventListener('click', () => {
        currentPlatform = (btn as HTMLElement).dataset.platform ?? currentPlatform;
        const models = modelsData.models[currentPlatform] ?? [];
        const defaultModel = models.find(m => m.isDefault);
        currentModel = defaultModel ? defaultModel.id : (models[0]?.id ?? '');
        renderContent();
      });
    });

    // Model selection
    const modelSelect = overlay.querySelector<HTMLSelectElement>('#settings-model');
    if (modelSelect !== null) {
      modelSelect.addEventListener('change', () => {
        currentModel = modelSelect.value;
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
          renderContent();
        })();
      });
    }

    // Guided review checkbox
    const guidedCheckbox = overlay.querySelector<HTMLInputElement>('#settings-guided-enabled');
    if (guidedCheckbox !== null) {
      guidedCheckbox.addEventListener('change', () => {
        guidedEnabled = guidedCheckbox.checked;
        renderContent();
      });
    }

    // Topic tags
    overlay.querySelectorAll('.settings-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const topic = (tag as HTMLElement).dataset.topic;
        if (topic !== undefined) {
          if (guidedTopics.has(topic)) {
            guidedTopics.delete(topic);
          } else {
            guidedTopics.add(topic);
            // When "Programming" is selected and no languages are checked, auto-select all
            if (topic === 'programming') {
              const hasAnyLang = [...guidedTopics].some(t => ALL_LANG_KEYS.has(t));
              if (!hasAnyLang) {
                for (const key of ALL_LANG_KEYS) guidedTopics.add(key);
                showMoreLangs = true;
              }
            }
          }
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

    // Cancel
    overlay.querySelector('.modal-cancel')?.addEventListener('click', () => { overlay.remove(); });

    // Save
    overlay.querySelector('#settings-save')?.addEventListener('click', () => {
      void (async () => {
        // Detect if guided review settings changed
        const prevEnabled = configData.guidedReview.enabled;
        const prevTopics = new Set(configData.guidedReview.topics);
        const newTopics = Array.from(guidedTopics);
        const guidedChanged = guidedEnabled !== prevEnabled ||
          newTopics.length !== prevTopics.size ||
          newTopics.some(t => !prevTopics.has(t));

        await api('/ai/config', {
          method: 'POST',
          body: {
            platform: currentPlatform,
            model: currentModel,
            guidedReview: {
              enabled: guidedEnabled,
              topics: newTopics,
            },
          },
        });

        // Save API key if entered
        const keyInput = overlay.querySelector<HTMLInputElement>('#settings-key');
        if (keyInput !== null && keyInput.value.trim() !== '') {
          const storageRadio = overlay.querySelector<HTMLInputElement>('input[name="key-storage"]:checked');
          const storage = storageRadio?.value ?? 'config';
          await api('/ai/key', {
            method: 'POST',
            body: { platform: currentPlatform, key: keyInput.value.trim(), storage },
          });
        }

        // Check if now configured
        const newConfig = await api<{ keyConfigured: boolean }>('/ai/config');
        state.aiConfigured = newConfig.keyConfigured;
        state.guidedReviewEnabled = guidedEnabled;

        // Update configData so subsequent saves detect changes correctly
        configData.guidedReview = { enabled: guidedEnabled, topics: newTopics };

        // Invalidate caches if guided review settings changed
        if (guidedChanged && state.aiConfigured) {
          // Invalidate risk/narrative (they use guided review hints)
          invalidateAnalysisCache();
          // Invalidate guided analysis (its own pipeline)
          invalidateGuidedAnalysis();
        }

        overlay.remove();
        if (onSave !== undefined) onSave();
      })();
    });

    // Click outside to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  overlay.innerHTML = (<div className="modal settings-dialog"></div>).toString();
  document.body.appendChild(overlay);
  renderContent();
}
