import { IconCheck } from '../../icons.js';
import type { SafeHtml } from '../../jsx-runtime.js';

interface KeyStatusInfo {
  configured: boolean;
  source: string | null;
}

interface ExperimentalTabData {
  platforms: Record<string, string>;
  currentPlatform: string;
  currentModel: string;
  platformModels: Array<{ id: string; name: string; isDefault: boolean }>;
  keyInfo: KeyStatusInfo;
  keychainAvailable: boolean;
  keychainLabel: string;
  guidedEnabled: boolean;
}

interface ExperimentalTabCallbacks {
  switchPlatform: (platform: string) => void;
  setModel: (model: string) => void;
  saveConfig: () => void;
  saveKey: () => void;
  removeKey: () => void;
  toggleGuided: (enabled: boolean) => void;
  renderContent: () => void;
}

function keyStatusHtml(keyInfo: KeyStatusInfo): SafeHtml {
  if (keyInfo.configured) {
    return (
      <div className="settings-key-status settings-key-configured">
        <IconCheck />
        <span>{'Configured via ' + (keyInfo.source ?? 'unknown')}</span>
        {keyInfo.source !== 'env' && (
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

function renderPlatformModels(models: Array<{ id: string; name: string; isDefault: boolean }>, currentModel: string): SafeHtml[] {
  return models.map(m =>
    <option value={m.id} selected={m.id === currentModel}>{m.name}{m.isDefault ? ' (recommended)' : ''}</option>
  );
}

export function renderExperimentalTab(data: ExperimentalTabData): SafeHtml {
  const { platforms, currentPlatform, currentModel, platformModels, keyInfo, keychainAvailable, keychainLabel, guidedEnabled } = data;
  const showInput = !keyInfo.configured;

  return (
    <>
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
          {Object.entries(platforms).map(([key, name]) => (
            <button className={`segment${key === currentPlatform ? ' active' : ''}`}
              data-platform={key}>{name}</button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <label className="settings-label">Model</label>
        <select className="settings-select" id="settings-model">{renderPlatformModels(platformModels, currentModel)}</select>
      </div>

      <div className="settings-section">
        <label className="settings-label">API Key</label>
        {keyStatusHtml(keyInfo)}
        {showInput && (
          <div className="settings-key-input-group">
            <div className="settings-key-row">
              <input type="password" className="settings-input" id="settings-key"
                placeholder="Enter API key..." autocomplete="off" />
              <button className="btn btn-xs btn-primary" id="save-key-btn">Save Key</button>
            </div>
            {keychainAvailable ? (
              <div className="settings-storage-options">
                <label className="settings-radio">
                  <input type="radio" name="key-storage" value="keychain" checked />
                  <span>{'Store in ' + keychainLabel}</span>
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
        Get AI explanations tailored to your experience level. Configure your profile in the Profile tab.
      </p>

      <div className="settings-section">
        <label className="settings-checkbox"><input type="checkbox" id="settings-guided-enabled" checked={guidedEnabled} /><span>Enable guided review</span></label>
      </div>
    </>
  );
}

export function bindExperimentalTabEvents(overlay: HTMLElement, callbacks: ExperimentalTabCallbacks): void {
  // Platform switching — save immediately
  overlay.querySelectorAll('.settings-platform-control .segment').forEach(btn => {
    btn.addEventListener('click', () => {
      const platform = (btn as HTMLElement).dataset.platform;
      if (platform !== undefined) {
        callbacks.switchPlatform(platform);
        callbacks.saveConfig();
        callbacks.renderContent();
      }
    });
  });

  // Model selection — save immediately
  const modelSelect = overlay.querySelector<HTMLSelectElement>('#settings-model');
  if (modelSelect !== null) {
    modelSelect.addEventListener('change', () => {
      callbacks.setModel(modelSelect.value);
      callbacks.saveConfig();
    });
  }

  // Remove key
  const removeBtn = overlay.querySelector('#remove-key');
  if (removeBtn !== null) {
    removeBtn.addEventListener('click', () => {
      callbacks.removeKey();
    });
  }

  // Save key button
  overlay.querySelector('#save-key-btn')?.addEventListener('click', callbacks.saveKey);

  // Save key on Enter
  const keyInput = overlay.querySelector<HTMLInputElement>('#settings-key');
  if (keyInput !== null) {
    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); callbacks.saveKey(); }
    });
  }

  // Guided review checkbox — save immediately
  const guidedCheckbox = overlay.querySelector<HTMLInputElement>('#settings-guided-enabled');
  if (guidedCheckbox !== null) {
    guidedCheckbox.addEventListener('change', () => {
      callbacks.toggleGuided(guidedCheckbox.checked);
      callbacks.saveConfig();
      callbacks.renderContent();
    });
  }
}
