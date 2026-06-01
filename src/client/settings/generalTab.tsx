import type { SafeHtml } from 'kerfjs';

import { IconSliders } from '../../icons.js';
import type { Tab, TabContext } from './tabContext.js';

function renderDifftoolSection(ctx: TabContext): SafeHtml {
  const { difftoolStatus } = ctx;
  const isRegistered = difftoolStatus.isGlassbox;
  const conflictTool = !isRegistered && difftoolStatus.tool !== null ? difftoolStatus.tool : null;
  return (
    <div className="settings-section">
      <label className="settings-label">Git difftool</label>
      {isRegistered ? (
        <div className="settings-difftool-row">
          <span className="settings-difftool-status settings-difftool-status--ok">
            Registered as your global <code>git difftool</code>.
          </span>
          <div className="settings-difftool-actions">
            <button className="btn btn-sm" id="difftool-register-btn">Re-register</button>
            <button className="btn btn-sm" id="difftool-unregister-btn">Unregister</button>
          </div>
        </div>
      ) : (
        <div className="settings-difftool-row">
          <span className="settings-difftool-status">
            {conflictTool !== null
              ? <>You currently have <code>{conflictTool}</code> set as your git difftool.</>
              : <>Not registered.</>}
          </span>
          <div className="settings-difftool-actions">
            <button className="btn btn-sm" id="difftool-register-btn">
              {conflictTool !== null ? <>Replace <code>{conflictTool}</code></> : 'Register'}
            </button>
          </div>
        </div>
      )}
      <p className="settings-hint">
        Lets you run <code>git difftool --dir-diff &lt;range&gt;</code> from any repo and review the change set in Glassbox.
      </p>
    </div>
  );
}

function renderGeneralTab(ctx: TabContext): SafeHtml {
  const { themesData, activeThemeId, appName, isTauri } = ctx;
  return (
    <>
      <div className="settings-section">
        <label className="settings-label">Theme</label>
        <div className="settings-theme-row">
          <select className="settings-select" id="settings-theme">
            {themesData.themes.filter(t => t.builtIn).map(t =>
              <option value={t.id} selected={t.id === activeThemeId}>{t.name}</option>
            )}
            {themesData.themes.some(t => !t.builtIn) && (
              <>
                <option disabled>{'─'.repeat(20)}</option>
                {themesData.themes.filter(t => !t.builtIn).map(t =>
                  <option value={t.id} selected={t.id === activeThemeId}>{t.name}</option>
                )}
              </>
            )}
          </select>
          <button className="btn btn-sm" id="manage-themes-btn">Manage Themes</button>
        </div>
      </div>
      {isTauri && (
        <div className="settings-section">
          <label className="settings-label">App Name</label>
          <input type="text" className="settings-input" id="settings-app-name" value={appName} placeholder="Glassbox — project-name" />
          <p className="settings-hint">Custom window title for the desktop app. Leave blank for the default.</p>
        </div>
      )}
      <div className="settings-divider"></div>
      {renderDifftoolSection(ctx)}
      <div className="settings-divider"></div>
      <div className="settings-section">
        <a className="settings-share-link" id="settings-share-link" href="#">Know someone who'd love this? <strong>Share Glassbox</strong></a>
      </div>
    </>
  );
}

export const generalTab: Tab = {
  id: 'general',
  label: 'General',
  icon: <IconSliders />,
  render: renderGeneralTab,
};
