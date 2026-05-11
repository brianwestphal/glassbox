import type { SafeHtml } from 'kerfjs';

import { IconCheck, IconFlask } from '../../icons.js';
import { api } from '../api.js';
import { TOAST_DURATION_MS } from '../timing.js';
import type { ChannelState, KeyStatusInfo, Tab, TabContext } from './tabContext.js';

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

function channelHintHtml(channelState: ChannelState): SafeHtml {
  if (!channelState.claudeInstalled) {
    return <p className="settings-hint" id="channel-hint">Claude Code CLI not found. Install it to use this feature.</p>;
  }
  if (!channelState.meetsMinimum) {
    return <p className="settings-hint" id="channel-hint">{'Claude Code v' + (channelState.claudeVersion ?? '?') + ' found. Version 2.1.80+ required.'}</p>;
  }
  return <p className="settings-hint settings-hint-ok" id="channel-hint">{'Claude Code v' + (channelState.claudeVersion ?? '') + ' detected.'}</p>;
}

function renderExperimentalTab(ctx: TabContext): SafeHtml {
  const { modelsData, currentPlatform, currentModel, keyStatus, guidedEnabled, channelState } = ctx;
  const platforms = modelsData.platforms;
  const platformModels = modelsData.models[currentPlatform] ?? [];
  const keyInfo = keyStatus.status[currentPlatform] ?? { configured: false, source: null };
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
                placeholder="Enter API key..." autoComplete="off" />
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
        Get AI explanations tailored to your experience level. Configure your profile in the Profile tab.
      </p>

      <div className="settings-section">
        <label className="settings-checkbox"><input type="checkbox" id="settings-guided-enabled" checked={guidedEnabled} /><span>Enable guided review</span></label>
      </div>

      <div className="settings-divider"></div>

      <div className="settings-section-header">
        <span className="settings-heading">Claude Channel</span>
        <span className="settings-beta-badge">Beta</span>
      </div>
      <p className="settings-disclaimer">
        Send review feedback directly to a running Claude Code session.
      </p>

      <div className="settings-section">
        <label className="settings-checkbox"><input type="checkbox" id="settings-channel-enabled" checked={channelState.enabled} /><span>Enable Claude Channel</span></label>
        {channelHintHtml(channelState)}
      </div>

      {channelState.enabled && (
        <div className="settings-channel-instructions">
          <p className="settings-label">Launch Claude Code in your project directory with channel support:</p>
          <div className="settings-channel-cmd">
            <code>claude --dangerously-load-development-channels server:glassbox-channel</code>
            <button className="btn btn-xs settings-channel-copy" id="channel-copy-btn">Copy</button>
          </div>
        </div>
      )}
    </>
  );
}

function bindExperimentalTab(overlay: HTMLElement, ctx: TabContext): void {
  overlay.querySelectorAll('.settings-platform-control .segment').forEach(btn => {
    btn.addEventListener('click', () => {
      const platform = (btn as HTMLElement).dataset.platform;
      if (platform !== undefined) {
        ctx.setCurrentPlatform(platform);
        ctx.saveConfig();
        ctx.renderContent();
      }
    });
  });

  const modelSelect = overlay.querySelector<HTMLSelectElement>('#settings-model');
  if (modelSelect !== null) {
    modelSelect.addEventListener('change', () => {
      ctx.setCurrentModel(modelSelect.value);
      ctx.saveConfig();
    });
  }

  overlay.querySelector('#remove-key')?.addEventListener('click', ctx.removeKey);
  overlay.querySelector('#save-key-btn')?.addEventListener('click', ctx.saveKey);

  const keyInput = overlay.querySelector<HTMLInputElement>('#settings-key');
  if (keyInput !== null) {
    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ctx.saveKey(); }
    });
  }

  const guidedCheckbox = overlay.querySelector<HTMLInputElement>('#settings-guided-enabled');
  if (guidedCheckbox !== null) {
    guidedCheckbox.addEventListener('change', () => {
      ctx.setGuidedEnabled(guidedCheckbox.checked);
      ctx.saveConfig();
      ctx.renderContent();
    });
  }

  const channelCheckbox = overlay.querySelector<HTMLInputElement>('#settings-channel-enabled');
  if (channelCheckbox !== null) {
    channelCheckbox.addEventListener('change', () => {
      const enabled = channelCheckbox.checked;
      ctx.setChannelEnabled(enabled);
      void api(enabled ? '/channel/enable' : '/channel/disable', { method: 'POST' });
      ctx.renderContent();
    });
  }

  const copyBtn = overlay.querySelector('#channel-copy-btn');
  if (copyBtn !== null) {
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText('claude --dangerously-load-development-channels server:glassbox-channel');
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, TOAST_DURATION_MS);
    });
  }
}

export const experimentalTab: Tab = {
  id: 'experimental',
  label: 'Experimental',
  icon: <IconFlask />,
  render: renderExperimentalTab,
  bind: bindExperimentalTab,
};
