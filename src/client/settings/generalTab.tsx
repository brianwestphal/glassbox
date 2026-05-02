import { IconSliders } from '../../icons.js';
import type { SafeHtml } from '../../jsx-runtime.js';
import { triggerShare } from '../share.js';
import type { Tab, TabContext } from './tabContext.js';

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
      <div className="settings-section">
        <a className="settings-share-link" id="settings-share-link" href="#">Know someone who'd love this? <strong>Share Glassbox</strong></a>
      </div>
    </>
  );
}

function bindGeneralTab(overlay: HTMLElement, ctx: TabContext): void {
  const themeSelect = overlay.querySelector<HTMLSelectElement>('#settings-theme');
  if (themeSelect !== null) {
    themeSelect.addEventListener('change', () => {
      ctx.setActiveThemeId(themeSelect.value);
      ctx.switchTheme(themeSelect.value);
    });
  }

  overlay.querySelector('#manage-themes-btn')?.addEventListener('click', () => {
    ctx.showThemeManager(() => {
      void (async () => {
        const updated = await ctx.refreshThemes();
        ctx.setActiveThemeId(updated.activeId);
        ctx.renderContent();
      })();
    });
  });

  overlay.querySelector('#settings-share-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    void triggerShare();
  });

  const appNameInput = overlay.querySelector<HTMLInputElement>('#settings-app-name');
  if (appNameInput !== null) {
    appNameInput.addEventListener('input', () => {
      ctx.setAppName(appNameInput.value);
      ctx.saveAppNameDebounced();
    });
  }
}

export const generalTab: Tab = {
  id: 'general',
  label: 'General',
  icon: <IconSliders />,
  render: renderGeneralTab,
  bind: bindGeneralTab,
};
