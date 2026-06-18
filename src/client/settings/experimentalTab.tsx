import type { SafeHtml } from 'kerfjs';

import type { AIKeyStatusEntry, AIPlatform } from '../../api/index.js';
import { IconCheck, IconFlask } from '../../icons.js';
import type { ChannelState, Tab, TabContext } from './tabContext.js';

function keyStatusHtml(keyInfo: AIKeyStatusEntry): SafeHtml {
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
  // Keep a saved-but-currently-absent model selectable rather than silently
  // dropping it (e.g. a local model not in the latest discovery list).
  const list = currentModel === '' || models.some(m => m.id === currentModel)
    ? models
    : [{ id: currentModel, name: currentModel, isDefault: false }, ...models];
  return list.map(m =>
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
  const { modelsData, currentPlatform, currentModel, localEndpoint, keyStatus, guidedEnabled, channelState } = ctx;
  const platforms = modelsData.platforms;
  const platformModels = modelsData.models[currentPlatform as AIPlatform];
  const keyInfo = keyStatus.status[currentPlatform as AIPlatform];
  const isLocal = currentPlatform === 'local';
  // Apple Foundation Models are on-device and keyless — no endpoint, no key.
  const isApple = currentPlatform === 'apple';
  const showInput = !isApple && !keyInfo.configured;

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
          {Object.entries(platforms)
            // Apple Foundation Models appear only when the on-device helper is
            // available (macOS 26 + Apple Intelligence); every other platform
            // always shows. The records carry all platform keys, so the gate is
            // this flag, not key omission.
            .filter(([key]) => key !== 'apple' || modelsData.appleAvailable)
            .map(([key, name]) => (
              <button className={`segment${key === currentPlatform ? ' active' : ''}`}
                data-platform={key}>{name}</button>
            ))}
        </div>
      </div>

      {isLocal && (
        <div className="settings-section">
          <label className="settings-label">Server URL</label>
          <input type="text" className="settings-input" id="settings-local-endpoint"
            value={localEndpoint} placeholder="http://localhost:11434/v1" autoComplete="off" />
          <p className="settings-hint">OpenAI-compatible endpoint (Ollama, LM Studio, …). The model list loads from here.</p>
        </div>
      )}

      <div className="settings-section">
        <label className="settings-label">Model</label>
        <select className="settings-select" id="settings-model">{renderPlatformModels(platformModels, currentModel)}</select>
        {isApple && (
          <p className="settings-hint">Runs fully on-device via Apple Intelligence (macOS 26+). No API key or network — free and private.</p>
        )}
      </div>

      {!isApple && (
      <div className="settings-section">
        <label className="settings-label">{isLocal ? 'API Key (optional)' : 'API Key'}</label>
        {isLocal && !keyInfo.configured && (
          <p className="settings-hint">Most local servers (e.g. Ollama) need no key — add one only if yours requires it.</p>
        )}
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
      )}

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

export const experimentalTab: Tab = {
  id: 'experimental',
  label: 'Experimental',
  icon: <IconFlask />,
  render: renderExperimentalTab,
};
