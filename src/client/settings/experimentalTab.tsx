import type { SafeHtml } from 'kerfjs';

import type { AIKeyStatusEntry, AIPlatform } from '../../api/index.js';
import { IconCheck, IconFlask } from '../../icons.js';
import type { ChannelState, KeyStatusResponse, Tab, TabContext } from './tabContext.js';

/** Element ids for one API-key block, so the same markup serves the primary
 *  platform and the Apple-FM fallback platform without id collisions. */
interface KeyBlockIds { input: string; saveBtn: string; remove: string; storage: string }

const PRIMARY_KEY_IDS: KeyBlockIds = { input: 'settings-key', saveBtn: 'save-key-btn', remove: 'remove-key', storage: 'key-storage' };
const FALLBACK_KEY_IDS: KeyBlockIds = { input: 'settings-fallback-key', saveBtn: 'save-fallback-key-btn', remove: 'remove-fallback-key', storage: 'fallback-key-storage' };

/** Status line + (when missing) entry form for a single platform's API key.
 *  Shared by the primary and the fallback so both stay in sync. */
function platformKeyUi(keyInfo: AIKeyStatusEntry, keyStatus: KeyStatusResponse, ids: KeyBlockIds, isLocal: boolean): SafeHtml {
  if (keyInfo.configured) {
    return (
      <div className="settings-key-status settings-key-configured">
        <IconCheck />
        <span>{'Configured via ' + (keyInfo.source ?? 'unknown')}</span>
        {keyInfo.source !== 'env' && (
          <button className="btn btn-xs btn-danger" id={ids.remove}>Remove</button>
        )}
      </div>
    );
  }
  return (
    <>
      {isLocal && (
        <p className="settings-hint">Most local servers (e.g. Ollama) need no key — add one only if yours requires it.</p>
      )}
      <div className="settings-key-status">
        <span className="settings-key-missing">Not configured</span>
      </div>
      <div className="settings-key-input-group">
        <div className="settings-key-row">
          <input type="password" className="settings-input" id={ids.input}
            placeholder="Enter API key..." autoComplete="off" />
          <button className="btn btn-xs btn-primary" id={ids.saveBtn}>Save Key</button>
        </div>
        {keyStatus.keychainAvailable ? (
          <div className="settings-storage-options">
            <label className="settings-radio">
              <input type="radio" name={ids.storage} value="keychain" checked />
              <span>{'Store in ' + keyStatus.keychainLabel}</span>
            </label>
            <label className="settings-radio">
              <input type="radio" name={ids.storage} value="config" />
              <span>Store in config file</span>
            </label>
          </div>
        ) : (
          <div className="settings-storage-options">
            <label className="settings-radio">
              <input type="radio" name={ids.storage} value="config" checked />
              <span>Store in ~/.glassbox/config.json</span>
            </label>
            <p className="settings-warning">Key will be stored with basic encoding (not encrypted). Only use for local development.</p>
          </div>
        )}
      </div>
    </>
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
  const { modelsData, currentPlatform, currentModel, localEndpoint, keyStatus, guidedEnabled, channelState, fallbackPlatform, fallbackModel } = ctx;
  const platforms = modelsData.platforms;
  const platformModels = modelsData.models[currentPlatform as AIPlatform];
  const keyInfo = keyStatus.status[currentPlatform as AIPlatform];
  const isLocal = currentPlatform === 'local';
  // Apple Foundation Models are on-device and keyless — no endpoint, no key.
  const isApple = currentPlatform === 'apple';
  // Apple-FM fallback: the secondary model picked for batches the on-device
  // model can't handle. Only meaningful while Apple is the selected platform.
  const hasFallback = fallbackPlatform !== '';
  const fallbackModels = hasFallback ? modelsData.models[fallbackPlatform as AIPlatform] : [];
  const fallbackKeyInfo = hasFallback ? keyStatus.status[fallbackPlatform as AIPlatform] : undefined;

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
            // Apple appears only when `appleAvailable` is set by the server.
            // It is currently force-disabled there (the on-device model's
            // 4096-token window can't fit the analysis prompt + output), so the
            // Apple button never shows; every other platform always does. The
            // records carry all platform keys, so the gate is this flag, not
            // key omission.
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
        {platformKeyUi(keyInfo, keyStatus, PRIMARY_KEY_IDS, isLocal)}
      </div>
      )}

      {isApple && (
      <div className="settings-section">
        <label className="settings-label">Fallback model</label>
        <p className="settings-hint">
          The on-device model has a small context window and can’t analyze large diffs. When a file is too big (or on-device analysis otherwise fails), Glassbox uses this model for that file instead.
        </p>
        <select className="settings-select" id="settings-fallback-platform">
          <option value="" selected={!hasFallback}>None — skip files too large for on-device</option>
          {Object.entries(platforms)
            .filter(([key]) => key !== 'apple')
            .map(([key, name]) => (
              <option value={key} selected={key === fallbackPlatform}>{name}</option>
            ))}
        </select>
        {hasFallback && (
          <>
            {fallbackPlatform === 'local' && (
              // Same shared `ai.localEndpoint` as a primary-local server; the
              // primary input is hidden while Apple is the platform, so reusing
              // the id here is safe (no duplicate). Editing it re-discovers the
              // local model list for the dropdown below.
              <>
                <input type="text" className="settings-input" id="settings-local-endpoint"
                  value={localEndpoint} placeholder="http://localhost:11434/v1" autoComplete="off" />
                <p className="settings-hint">OpenAI-compatible endpoint (Ollama, LM Studio, …). The fallback model list loads from here.</p>
              </>
            )}
            <select className="settings-select settings-fallback-model" id="settings-fallback-model">
              {renderPlatformModels(fallbackModels, fallbackModel)}
            </select>
            {fallbackKeyInfo !== undefined && platformKeyUi(fallbackKeyInfo, keyStatus, FALLBACK_KEY_IDS, fallbackPlatform === 'local')}
          </>
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
