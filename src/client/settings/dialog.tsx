import { raw } from '../../jsx-runtime.js';
import { api } from '../api.js';
import { toElement } from '../dom.js';
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

const ICON_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

export function showSettingsDialog(onSave?: () => void) {
  void (async () => {
    const [keyStatus, modelsData, configData] = await Promise.all([
      api<KeyStatusResponse>('/ai/key-status'),
      api<ModelsResponse>('/ai/models'),
      api<{ platform: string; model: string; keyConfigured: boolean; keySource: string | null }>('/ai/config'),
    ]);

    renderSettingsModal(keyStatus, modelsData, configData, onSave);
  })();
}

function renderSettingsModal(
  keyStatus: KeyStatusResponse,
  modelsData: ModelsResponse,
  configData: { platform: string; model: string; keyConfigured: boolean; keySource: string | null },
  onSave?: () => void,
) {
  const overlay = toElement(<div className="modal-overlay"></div>);

  let currentPlatform = configData.platform;
  let currentModel = configData.model;

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

  function renderContent() {
    const info = getKeyInfo(currentPlatform);
    const showInput = !info.configured;

    const modalEl = overlay.querySelector('.modal');
    if (modalEl === null) return;

    modalEl.innerHTML = (
      <>
        <h3>AI Settings</h3>

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
        // Update model to default for new platform
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
          // Refresh key status
          const newStatus = await api<KeyStatusResponse>('/ai/key-status');
          keyStatus.status = newStatus.status;
          renderContent();
        })();
      });
    }

    // Cancel
    overlay.querySelector('.modal-cancel')?.addEventListener('click', () => { overlay.remove(); });

    // Save
    overlay.querySelector('#settings-save')?.addEventListener('click', () => {
      void (async () => {
        // Save platform/model config
        await api('/ai/config', {
          method: 'POST',
          body: { platform: currentPlatform, model: currentModel },
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
